import { NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminApp, getAdminFirestore } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/auth/authorization";

export const runtime = "nodejs";

const MANAGED_COLLECTIONS = new Set(["content", "categories", "prompts", "tools", "challenges", "notices"]);
const SETTINGS_COLLECTION = "settings";

type JsonRecord = Record<string, unknown>;

function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const object = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof object.toDate === "function") return object.toDate().toISOString();
    if (Array.isArray(value)) return value.map(jsonSafe);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
}

function cleanDocument(id: string, data: JsonRecord | undefined): JsonRecord & { id: string } {
  return { id, ...(jsonSafe(data || {}) as JsonRecord) };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro interno";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (message === "Não autenticado" || code.startsWith("auth/")) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (message === "Acesso administrativo negado") return NextResponse.json({ error: message }, { status: 403 });
  console.error("admin_api_error", message);
  return NextResponse.json({ error: "Não foi possível concluir a operação." }, { status: 500 });
}

async function listCollection(collection: string, limit = 100) {
  const snapshot = await getAdminFirestore().collection(collection).limit(limit).get();
  return snapshot.docs.map((doc) => cleanDocument(doc.id, doc.data()));
}

async function getDashboard() {
  const firestore = getAdminFirestore();
  const [usersSnapshot, purchasesSnapshot, eventsSnapshot] = await Promise.all([
    firestore.collection("users").get(),
    firestore.collection("purchases").get(),
    firestore.collection("webhook_events").get(),
  ]);
  const users = usersSnapshot.docs.map((doc) => cleanDocument(doc.id, doc.data()));
  const purchases = purchasesSnapshot.docs.map((doc) => cleanDocument(doc.id, doc.data()));
  const events = eventsSnapshot.docs.map((doc) => cleanDocument(doc.id, doc.data()));
  const approved = purchases.filter((item) => item.status === "approved");
  const revenue = approved.reduce((sum, item) => sum + (typeof item.amount === "number" ? item.amount : 0), 0);
  const recent = [...purchases, ...events]
    .sort((a, b) => String(b.updatedAt || b.receivedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.receivedAt || a.createdAt || "")))
    .slice(0, 8);
  return {
    stats: {
      totalUsers: users.length,
      activeUsers: users.filter((item) => item.status === "active").length,
      blockedUsers: users.filter((item) => item.status === "blocked").length,
      approvedSales: approved.length,
      revenue,
      refunds: purchases.filter((item) => item.status === "refunded").length,
      chargebacks: purchases.filter((item) => item.status === "chargeback").length,
    },
    salesByStatus: {
      approved: approved.length,
      refunded: purchases.filter((item) => item.status === "refunded").length,
      chargeback: purchases.filter((item) => item.status === "chargeback").length,
    },
    recent,
    integration: {
      configured: Boolean(process.env.KIWIFY_ACCOUNT_ID && process.env.KIWIFY_PRODUCT_ID && process.env.KIWIFY_WEBHOOK_PATH_SECRET),
      productConfigured: Boolean(process.env.KIWIFY_PRODUCT_ID),
      webhookSecretConfigured: Boolean(process.env.KIWIFY_WEBHOOK_PATH_SECRET),
      receivedEvents: events.length,
      processedEvents: events.filter((item) => item.processed === true).length,
      pendingEvents: events.filter((item) => item.processed !== true).length,
      lastEvent: events.sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")))[0] || null,
    },
  };
}

async function getUsers() {
  const users = await listCollection("users");
  const purchases = await listCollection("purchases", 500);
  return users.map((user) => ({
    ...user,
    purchases: purchases.filter((purchase) => purchase.userId === user.id),
  }));
}

async function getPurchases() {
  const purchases = await listCollection("purchases", 500);
  const users = await listCollection("users", 500);
  return purchases.map((purchase) => ({
    ...purchase,
    user: users.find((user) => user.id === purchase.userId) || null,
  }));
}

async function getIntegration() {
  const [events, diagnostics] = await Promise.all([
    listCollection("webhook_events", 100),
    listCollection("webhook_diagnostics", 50),
  ]);
  return {
    configured: Boolean(process.env.KIWIFY_ACCOUNT_ID && process.env.KIWIFY_PRODUCT_ID && process.env.KIWIFY_WEBHOOK_PATH_SECRET),
    productConfigured: Boolean(process.env.KIWIFY_PRODUCT_ID),
    receivedEvents: events.length,
    processedEvents: events.filter((event) => event.processed === true).length,
    rejectedEvents: events.filter((event) => event.processed === false).length,
    events,
    diagnostics,
  };
}

function payloadFromRequest(body: JsonRecord) {
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Dados inválidos");
  return data as JsonRecord;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const resource = new URL(request.url).searchParams.get("resource") || "dashboard";
    if (resource === "dashboard") return NextResponse.json(await getDashboard());
    if (resource === "users") return NextResponse.json(await getUsers());
    if (resource === "purchases") return NextResponse.json(await getPurchases());
    if (resource === "integration") return NextResponse.json(await getIntegration());
    if (resource === SETTINGS_COLLECTION) return NextResponse.json(await listCollection(SETTINGS_COLLECTION, 50));
    if (MANAGED_COLLECTIONS.has(resource)) return NextResponse.json(await listCollection(resource, 500));
    throw new Error("Recurso inválido");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json() as JsonRecord;
    const resource = typeof body.resource === "string" ? body.resource : "";
    const data = payloadFromRequest(body);
    if (!MANAGED_COLLECTIONS.has(resource) && resource !== SETTINGS_COLLECTION) throw new Error("Recurso inválido");
    const ref = await getAdminFirestore().collection(resource).add({ ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const decoded = await requireAdmin(request);
    const body = await request.json() as JsonRecord;
    const resource = typeof body.resource === "string" ? body.resource : "";
    const id = typeof body.id === "string" ? body.id : "";
    const data = payloadFromRequest(body);
    if (!id) throw new Error("Identificador inválido");
    const firestore = getAdminFirestore();
    if (resource === "users") {
      const userRef = firestore.collection("users").doc(id);
      const snapshot = await userRef.get();
      if (!snapshot.exists) throw new Error("Usuário não encontrado");
      const status = data.status === "blocked" ? "blocked" : "active";
      await userRef.set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await getAuth(getFirebaseAdminApp()).updateUser(id, { disabled: status === "blocked" });
      return NextResponse.json({ ok: true, by: decoded.uid });
    }
    if (!MANAGED_COLLECTIONS.has(resource) && resource !== SETTINGS_COLLECTION) throw new Error("Recurso inválido");
    await firestore.collection(resource).doc(id).set({ ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json() as JsonRecord;
    const resource = typeof body.resource === "string" ? body.resource : "";
    const id = typeof body.id === "string" ? body.id : "";
    if (!id || (!MANAGED_COLLECTIONS.has(resource) && resource !== SETTINGS_COLLECTION)) throw new Error("Recurso inválido");
    await getAdminFirestore().collection(resource).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
