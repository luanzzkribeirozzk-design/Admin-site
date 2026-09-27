import { NextResponse } from "next/server";
import { isKiwifyApiConfigured } from "@/lib/kiwify/client";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "renda-mobile-admin",
    firebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
    kiwifyApiConfigured: isKiwifyApiConfigured(),
    timestamp: new Date().toISOString(),
  });
}
