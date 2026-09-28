import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { processKiwifyWebhook, validateClassicPayload, verifyWebhookPathSecret } from "@/services/kiwify-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const payloadSchema = z.record(z.string(), z.unknown());

type RouteContext = { params: Promise<{ secret: string }> };

async function saveDiagnostic(fields: Record<string, unknown>) {
  try {
    await getAdminFirestore().collection("webhook_diagnostics").add({
      ...fields,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Falha ao gravar diagnóstico do webhook Kiwify", {
      name: error instanceof Error ? error.name : "unknown",
    });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { secret } = await context.params;
  const pathValidation = verifyWebhookPathSecret(secret);
  if (!pathValidation.ok) {
    await saveDiagnostic({ validation: "rejected", statusHttp: pathValidation.reason === "path_secret_not_configured" ? 503 : 401, processing: "not_run", path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: false, error: "webhook não autorizado" }, { status: pathValidation.reason === "path_secret_not_configured" ? 503 : 401 });
  }

  const rawBody = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    await saveDiagnostic({ validation: "rejected", statusHttp: 400, processing: "not_run", path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const validation = payloadSchema.safeParse(parsed);
  if (!validation.success) {
    await saveDiagnostic({ validation: "rejected", statusHttp: 400, processing: "not_run", path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
  }

  const payloadValidation = validateClassicPayload(validation.data);
  if (!payloadValidation.ok) {
    await saveDiagnostic({ validation: "rejected", statusHttp: payloadValidation.reason.endsWith("not_configured") ? 503 : 403, processing: "not_run", path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: false, error: "webhook não autorizado" }, { status: payloadValidation.reason.endsWith("not_configured") ? 503 : 403 });
  }

  try {
    const result = await processKiwifyWebhook(validation.data, rawBody);
    const status = result.kind === "ignored" ? 202 : 200;
    await saveDiagnostic({ validation: "approved", statusHttp: status, processing: result.kind, path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: true, ...result }, { status });
  } catch (error) {
    console.error("Falha ao processar webhook Kiwify", { name: error instanceof Error ? error.name : "unknown" });
    await saveDiagnostic({ validation: "approved", statusHttp: 500, processing: "error", path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: false, error: "falha interna ao processar webhook" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, method: "POST", endpoint: "/api/kiwify/webhook/[secret]" });
}
