import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { processKiwifyWebhook, verifyWebhookToken } from "@/services/kiwify-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const payloadSchema = z.record(z.string(), z.unknown());

type DiagnosticValidation = "approved" | "rejected" | "unknown";

type WebhookDiagnostic = {
  method: string;
  path: string;
  tokenHeaderPresent: boolean;
  bodyPresent: boolean;
  validation: DiagnosticValidation;
  statusHttp: number;
  processing: string;
};

async function saveWebhookDiagnostic(diagnostic: WebhookDiagnostic) {
  try {
    await getAdminFirestore().collection("webhook_diagnostics").add({
      ...diagnostic,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Falha ao gravar diagnóstico do webhook Kiwify", {
      name: error instanceof Error ? error.name : "unknown",
    });
  }
}

function requestMetadata(request: Request, rawBody: string) {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    tokenHeaderPresent: ["x-kiwify-webhook-token", "x-webhook-token", "authorization"].some((header) => request.headers.has(header)),
    bodyPresent: rawBody.length > 0,
  };
}

function logWebhookDiagnostic(fields: Record<string, unknown>) {
  console.info("Kiwify webhook diagnostic", {
    timestamp: new Date().toISOString(),
    ...fields,
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const metadata = requestMetadata(request, rawBody);
  logWebhookDiagnostic(metadata);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    logWebhookDiagnostic({ validation: "invalid_json", responseStatus: 400 });
    await saveWebhookDiagnostic({ ...metadata, validation: "unknown", statusHttp: 400, processing: "not_run" });
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const validation = payloadSchema.safeParse(parsed);
  if (!validation.success) {
    logWebhookDiagnostic({ validation: "invalid_payload", responseStatus: 400 });
    await saveWebhookDiagnostic({ ...metadata, validation: "unknown", statusHttp: 400, processing: "not_run" });
    return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
  }

  const token = verifyWebhookToken(validation.data);
  if (!token.ok) {
    const status = token.reason === "token_not_configured" ? 503 : 401;
    logWebhookDiagnostic({ validation: "token_rejected", responseStatus: status });
    await saveWebhookDiagnostic({ ...metadata, validation: "rejected", statusHttp: status, processing: "not_run" });
    return NextResponse.json({ ok: false, error: "webhook não autorizado" }, { status });
  }
  logWebhookDiagnostic({ validation: "token_approved" });

  try {
    const result = await processKiwifyWebhook(validation.data, rawBody);
    if (result.kind === "duplicate") {
      logWebhookDiagnostic({ processing: "duplicate", responseStatus: 200 });
      await saveWebhookDiagnostic({ ...metadata, validation: "approved", statusHttp: 200, processing: "duplicate" });
      return NextResponse.json({ ok: true, duplicate: true, eventId: result.eventId });
    }
    const responseStatus = result.kind === "ignored" ? 202 : 200;
    logWebhookDiagnostic({ processing: result.kind, responseStatus });
    await saveWebhookDiagnostic({ ...metadata, validation: "approved", statusHttp: responseStatus, processing: result.kind });
    return NextResponse.json({ ok: true, ...result }, { status: responseStatus });
  } catch (error) {
    logWebhookDiagnostic({ processing: "error", responseStatus: 500 });
    await saveWebhookDiagnostic({ ...metadata, validation: "approved", statusHttp: 500, processing: "error" });
    console.error("Falha ao processar webhook Kiwify", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: "falha interna ao processar webhook" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, method: "POST", endpoint: "/api/kiwify/webhook" });
}
