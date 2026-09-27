import { createHash, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { KiwifyWebhookPayload, PurchaseStatus } from "@/types/domain";

const SUPPORTED_EVENTS = new Set(["compra_aprovada", "compra_reembolsada", "chargeback"]);
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyWebhookToken(payload: KiwifyWebhookPayload) {
  const expected = process.env.KIWIFY_WEBHOOK_TOKEN;
  if (!expected) return { ok: false as const, reason: "token_not_configured" };
  const supplied = typeof payload.token === "string" ? payload.token : "";
  return safeEqual(supplied, expected)
    ? { ok: true as const }
    : { ok: false as const, reason: "token_invalid" };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nestedData(payload: KiwifyWebhookPayload) {
  return (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
}

export function normalizeEvent(payload: KiwifyWebhookPayload, rawBody: string) {
  const data = nestedData(payload);
  const eventType = stringValue(payload.event) || stringValue(payload.type) || stringValue(data.event) || stringValue(data.type);
  const eventId = stringValue(payload.event_id) || stringValue(payload.id) || stringValue(data.event_id) || stringValue(data.id);
  const transactionId = stringValue(data.transaction_id) || stringValue(data.transactionId) || stringValue(data.order_id) || stringValue(data.id);
  const email = stringValue(data.email) || stringValue(data.customer_email) || stringValue(data.customerEmail);
  const name = stringValue(data.name) || stringValue(data.customer_name) || stringValue(data.customerName);
  const productId = stringValue(data.product_id) || stringValue(data.productId) || stringValue(data.product);
  const amount = typeof data.amount === "number" ? data.amount : undefined;
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  return { eventType, eventId: eventId || `payload:${payloadHash}`, transactionId, email, name, productId, amount, payloadHash };
}

function purchaseStatus(eventType: string): PurchaseStatus | undefined {
  if (eventType === "compra_aprovada") return "approved";
  if (eventType === "compra_reembolsada") return "refunded";
  if (eventType === "chargeback") return "chargeback";
  return undefined;
}

export async function processKiwifyWebhook(payload: KiwifyWebhookPayload, rawBody: string) {
  const normalized = normalizeEvent(payload, rawBody);
  if (!normalized.eventType || !SUPPORTED_EVENTS.has(normalized.eventType)) {
    return { kind: "ignored" as const, eventId: normalized.eventId, reason: "evento não suportado" };
  }
  const firestore = getAdminFirestore();
  const eventRef = firestore.collection("webhook_events").doc(normalized.eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 150));
  const purchase = purchaseStatus(normalized.eventType);

  const result = await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(eventRef);
    if (existing.exists && existing.data()?.processed === true) return "duplicate" as const;
    transaction.set(eventRef, {
      eventId: normalized.eventId,
      eventType: normalized.eventType,
      processed: false,
      receivedAt: FieldValue.serverTimestamp(),
      payloadHash: normalized.payloadHash,
    }, { merge: true });

    if (normalized.transactionId && purchase) {
      const purchaseRef = firestore.collection("purchases").doc(normalized.transactionId);
      transaction.set(purchaseRef, {
        transactionId: normalized.transactionId,
        productId: normalized.productId || process.env.KIWIFY_PRODUCT_ID || null,
        status: purchase,
        amount: normalized.amount ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        ...(normalized.email ? { customerEmail: normalized.email } : {}),
      }, { merge: true });
    }

    transaction.update(eventRef, { processed: true, processedAt: FieldValue.serverTimestamp() });
    return "processed" as const;
  });

  return { kind: result, eventId: normalized.eventId };
}
