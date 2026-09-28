import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { inspectClassicPayload, processKiwifyWebhook, validateClassicPayload, verifyWebhookPathSecret } from "@/services/kiwify-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const payloadSchema = z.record(z.string(), z.unknown());
const SUPPORTED_EVENTS_FOR_DIAGNOSTIC = ["compra_aprovada", "compra_reembolsada", "chargeback", "order_approved", "order_refunded", "order_chargeback"];

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

function diagnosticType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function diagnosticRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function inspectAdditionalShape(payload: Record<string, unknown>) {
  const roots: Array<[string, Record<string, unknown>]> = [["payload", payload]];
  for (const key of ["Customer", "Product", "Subscription", "TrackingParameters"]) {
    const value = diagnosticRecord(payload[key]);
    if (Object.keys(value).length > 0) roots.push([key, value]);
  }
  const candidateStoreFields = roots.flatMap(([root, value]) => Object.keys(value)
    .filter((key) => /store|shop|account|merchant|seller|producer/i.test(key))
    .map((key) => ({ field: root === "payload" ? key : `${root}.${key}`, type: diagnosticType(value[key]) })));
  const product = diagnosticRecord(payload.Product || payload.product);
  const productFields = Object.fromEntries(Object.keys(product).sort().map((key) => [key, diagnosticType(product[key])]));
  const productIdCandidates = Object.keys(product).filter((key) => /(^|_)(id|product_id)$|product.*id|id$/i.test(key)).sort();
  const eventName = typeof payload.webhook_event_type === "string" ? payload.webhook_event_type : null;
  return { candidateStoreFields, productFields, productIdCandidates, eventName, supportedEvents: SUPPORTED_EVENTS_FOR_DIAGNOSTIC };
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

  const additionalShape = inspectAdditionalShape(validation.data);
  const stages = inspectClassicPayload(validation.data);
  const payloadValidation = validateClassicPayload(validation.data);
  if (!payloadValidation.ok) {
    await saveDiagnostic({ ...additionalShape, ...stages, validation: "rejected", statusHttp: payloadValidation.reason.endsWith("not_configured") ? 503 : 403, processing: "not_run", path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: false, error: "webhook não autorizado" }, { status: payloadValidation.reason.endsWith("not_configured") ? 503 : 403 });
  }

  try {
    const result = await processKiwifyWebhook(validation.data, rawBody);
    const status = result.kind === "ignored" ? 202 : 200;
    await saveDiagnostic({ ...additionalShape, ...stages, validation: "approved", statusHttp: status, processing: result.kind, path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: true, ...result }, { status });
  } catch (error) {
    console.error("Falha ao processar webhook Kiwify", { name: error instanceof Error ? error.name : "unknown" });
    await saveDiagnostic({ ...additionalShape, ...stages, validation: "approved", statusHttp: 500, processing: "error", path: "/api/kiwify/webhook/[secret]" });
    return NextResponse.json({ ok: false, error: "falha interna ao processar webhook" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, method: "POST", endpoint: "/api/kiwify/webhook/[secret]" });
}
