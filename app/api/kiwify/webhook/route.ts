import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const payloadSchema = z.record(z.string(), z.unknown());

type WebhookDiagnostic = {
  method: string;
  path: string;
  tokenHeaderPresent: boolean;
  bodyPresent: boolean;
  payloadKeys: string[];
  payloadTypes: Record<string, string>;
  tokenPresent: boolean;
  tokenLength: number | null;
  headerNames: string[];
  validation: "unknown";
  statusHttp: number;
  processing: "diagnostic_only" | "not_run";
};

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function describePayload(payload: Record<string, unknown>) {
  const payloadKeys = Object.keys(payload).sort();
  const payloadTypes = Object.fromEntries(payloadKeys.map((key) => [key, valueType(payload[key])]));
  const token = payload.token;
  return {
    payloadKeys,
    payloadTypes,
    tokenPresent: Object.prototype.hasOwnProperty.call(payload, "token"),
    tokenLength: typeof token === "string" ? token.length : null,
  };
}

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

function logWebhookDiagnostic(fields: Record<string, unknown>) {
  console.info("Kiwify webhook diagnostic", {
    timestamp: new Date().toISOString(),
    ...fields,
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headerNames = Array.from(request.headers.keys()).sort();
  const metadata = {
    method: request.method,
    path: new URL(request.url).pathname,
    tokenHeaderPresent: ["x-kiwify-webhook-token", "x-webhook-token", "authorization"].some((header) => request.headers.has(header)),
    bodyPresent: rawBody.length > 0,
    headerNames,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    await saveWebhookDiagnostic({
      ...metadata,
      payloadKeys: [],
      payloadTypes: {},
      tokenPresent: false,
      tokenLength: null,
      validation: "unknown",
      statusHttp: 400,
      processing: "not_run",
    });
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const validation = payloadSchema.safeParse(parsed);
  if (!validation.success) {
    await saveWebhookDiagnostic({
      ...metadata,
      payloadKeys: [],
      payloadTypes: {},
      tokenPresent: false,
      tokenLength: null,
      validation: "unknown",
      statusHttp: 400,
      processing: "not_run",
    });
    return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
  }

  const shape = describePayload(validation.data);
  logWebhookDiagnostic({
    method: metadata.method,
    path: metadata.path,
    headerNames: metadata.headerNames,
    payloadKeys: shape.payloadKeys,
    payloadTypes: shape.payloadTypes,
    tokenPresent: shape.tokenPresent,
    tokenLength: shape.tokenLength,
    processing: "diagnostic_only",
  });
  await saveWebhookDiagnostic({
    ...metadata,
    ...shape,
    validation: "unknown",
    statusHttp: 204,
    processing: "diagnostic_only",
  });
  return new NextResponse(null, { status: 204 });
}

export function GET() {
  return NextResponse.json({ ok: true, method: "POST", endpoint: "/api/kiwify/webhook" });
}
