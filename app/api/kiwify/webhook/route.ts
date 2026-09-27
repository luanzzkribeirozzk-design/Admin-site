import { NextResponse } from "next/server";
import { z } from "zod";
import { processKiwifyWebhook, verifyWebhookToken } from "@/services/kiwify-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const payloadSchema = z.record(z.string(), z.unknown());

function logWebhookDiagnostic(fields: Record<string, unknown>) {
  console.info("Kiwify webhook diagnostic", {
    timestamp: new Date().toISOString(),
    ...fields,
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const hasKiwifyTokenHeader = request.headers.has("x-kiwify-webhook-token");
  const hasWebhookTokenHeader = request.headers.has("x-webhook-token");
  const hasAuthorizationHeader = request.headers.has("authorization");
  logWebhookDiagnostic({
    method: request.method,
    path: new URL(request.url).pathname,
    hasKiwifyTokenHeader,
    hasWebhookTokenHeader,
    hasAuthorizationHeader,
    bodyPresent: rawBody.length > 0,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    logWebhookDiagnostic({ validation: "invalid_json", responseStatus: 400 });
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const validation = payloadSchema.safeParse(parsed);
  if (!validation.success) {
    logWebhookDiagnostic({ validation: "invalid_payload", responseStatus: 400 });
    return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
  }

  const token = verifyWebhookToken(request, validation.data);
  if (!token.ok) {
    const status = token.reason.includes("não configurado") ? 503 : 401;
    logWebhookDiagnostic({
      validation: status === 503 ? "token_not_configured" : "token_invalid",
      responseStatus: status,
    });
    return NextResponse.json({ ok: false, error: "webhook não autorizado" }, { status });
  }
  logWebhookDiagnostic({ validation: "token_valid" });

  try {
    const result = await processKiwifyWebhook(validation.data, rawBody);
    if (result.kind === "duplicate") {
      logWebhookDiagnostic({ processing: "duplicate", responseStatus: 200 });
      return NextResponse.json({ ok: true, duplicate: true, eventId: result.eventId });
    }
    const responseStatus = result.kind === "ignored" ? 202 : 200;
    logWebhookDiagnostic({ processing: result.kind, responseStatus });
    return NextResponse.json({ ok: true, ...result }, { status: responseStatus });
  } catch (error) {
    logWebhookDiagnostic({ processing: "error", responseStatus: 500 });
    console.error("Falha ao processar webhook Kiwify", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: "falha interna ao processar webhook" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, method: "POST", endpoint: "/api/kiwify/webhook" });
}
