import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: false, error: "webhook endpoint moved" }, { status: 404 });
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "webhook endpoint moved" }, { status: 404 });
}
