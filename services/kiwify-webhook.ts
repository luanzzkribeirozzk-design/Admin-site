import { createHash, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { KiwifyWebhookPayload, PurchaseStatus } from "@/types/domain";

const SUPPORTED_EVENTS = new Set([
  "compra_aprovada",
  "compra_reembolsada",
  "chargeback",
  "order_approved",
  "order_refunded",
  "order_chargeback",
]);

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nestedData(payload: KiwifyWebhookPayload) {
  return recordValue(payload.data);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyWebhookPathSecret(secret: string) {
  const expected = process.env.KIWIFY_WEBHOOK_PATH_SECRET;
  if (!expected) return { ok: false as const, reason: "path_secret_not_configured" };
  return safeEqual(secret, expected)
    ? { ok: true as const }
    : { ok: false as const, reason: "path_secret_invalid" };
}

export function validateClassicPayload(payload: KiwifyWebhookPayload) {
  const expectedStoreId = process.env.KIWIFY_STORE_ID || process.env.KIWIFY_ACCOUNT_ID;
  const expectedProductId = process.env.KIWIFY_PRODUCT_ID;
  const storeId = stringValue(payload.store_id);
  const product = recordValue(payload.Product || payload.product);
  const productId = stringValue(product.product_id || product.productId);
  const eventType = stringValue(payload.webhook_event_type) || stringValue(payload.event) || stringValue(payload.type);

  if (!expectedStoreId) return { ok: false as const, reason: "store_not_configured" };
  if (!expectedProductId) return { ok: false as const, reason: "product_not_configured" };
  if (!storeId || !safeEqual(storeId, expectedStoreId)) return { ok: false as const, reason: "store_invalid" };
  if (!productId || !safeEqual(productId, expectedProductId)) return { ok: false as const, reason: "product_invalid" };
  if (!eventType || !SUPPORTED_EVENTS.has(eventType)) return { ok: false as const, reason: "event_unsupported" };
  return { ok: true as const };
}

function purchaseStatus(eventType: string): PurchaseStatus | undefined {
  if (eventType === "compra_aprovada" || eventType === "order_approved") return "approved";
  if (eventType === "compra_reembolsada" || eventType === "order_refunded") return "refunded";
  if (eventType === "chargeback" || eventType === "order_chargeback") return "chargeback";
  return undefined;
}

export function normalizeEvent(payload: KiwifyWebhookPayload, rawBody: string) {
  const data = nestedData(payload);
  const customer = recordValue(payload.Customer || payload.customer || data.Customer || data.customer);
  const product = recordValue(payload.Product || payload.product || data.Product || data.product);
  const commissions = recordValue(payload.Commissions || payload.commissions || data.Commissions || data.commissions);
  const eventType = stringValue(payload.webhook_event_type) || stringValue(payload.event) || stringValue(payload.type) || stringValue(data.event) || stringValue(data.type);
  const transactionId = stringValue(payload.order_id) || stringValue(payload.transaction_id) || stringValue(data.transaction_id) || stringValue(data.order_id) || stringValue(payload.id) || stringValue(data.id);
  const eventId = stringValue(payload.event_id) || (transactionId && eventType ? `${transactionId}:${eventType}` : undefined) || stringValue(payload.id) || stringValue(data.event_id) || stringValue(data.id);
  const email = stringValue(customer.email) || stringValue(data.email) || stringValue(data.customer_email) || stringValue(data.customerEmail);
  const name = stringValue(customer.full_name) || stringValue(customer.first_name) || stringValue(data.name) || stringValue(data.customer_name) || stringValue(data.customerName);
  const productId = stringValue(product.product_id) || stringValue(product.productId) || stringValue(data.product_id) || stringValue(data.productId) || stringValue(data.product);
  const rawAmount = payload.amount ?? commissions.charge_amount ?? commissions.my_commission ?? data.amount;
  const amount = typeof rawAmount === "number" ? rawAmount : typeof rawAmount === "string" && /^\d+(\.\d+)?$/.test(rawAmount) ? Number(rawAmount) : undefined;
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  return { eventType, eventId: eventId || `payload:${payloadHash}`, transactionId, email, name, productId, amount, payloadHash };
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
        ...(normalized.name ? { customerName: normalized.name } : {}),
      }, { merge: true });
    }

    transaction.update(eventRef, { processed: true, processedAt: FieldValue.serverTimestamp() });
    return "processed" as const;
  });

  return { kind: result, eventId: normalized.eventId };
}
