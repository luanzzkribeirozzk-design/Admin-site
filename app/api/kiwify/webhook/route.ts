import { NextResponse } from "next/server";
import { z } from "zod";
import { processKiwifyWebhook, verifyWebhookToken } from "@/services/kiwify-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const payloadSchema = z.record(z.string(), z.unknown());

export async function POST(request: Request) {
  const rawBody = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const validation = payloadSchema.safeParse(parsed);
  if (!validation.success) return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });

  const token = verifyWebhookToken(request, validation.data);
  if (!token.ok) {
    const status = token.reason.includes("não configurado") ? 503 : 401;
    return NextResponse.json({ ok: false, error: "webhook não autorizado" }, { status });
  }

  try {
    const result = await processKiwifyWebhook(validation.data, rawBody);
    if (result.kind === "duplicate") return NextResponse.json({ ok: true, duplicate: true, eventId: result.eventId });
    return NextResponse.json({ ok: true, ...result }, { status: result.kind === "ignored" ? 202 : 200 });
  } catch (error) {
    console.error("Falha ao processar webhook Kiwify", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: "falha interna ao processar webhook" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, method: "POST", endpoint: "/api/kiwify/webhook" });
}
