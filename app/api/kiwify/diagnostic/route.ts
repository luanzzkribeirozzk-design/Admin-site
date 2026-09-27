import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/authorization";
import { getAdminFirestore } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const snapshot = await getAdminFirestore()
      .collection("webhook_diagnostics")
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) return NextResponse.json({ ok: true, diagnostic: null });

    const data = snapshot.docs[0].data();
    const timestamp = data.timestamp && typeof data.timestamp.toDate === "function"
      ? data.timestamp.toDate().toISOString()
      : null;

    return NextResponse.json({
      ok: true,
      diagnostic: {
        timestamp,
        method: data.method ?? null,
        path: data.path ?? null,
        tokenHeaderPresent: data.tokenHeaderPresent === true,
        bodyPresent: data.bodyPresent === true,
        validation: data.validation ?? "unknown",
        statusHttp: typeof data.statusHttp === "number" ? data.statusHttp : null,
        processing: data.processing ?? "unknown",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }
}
