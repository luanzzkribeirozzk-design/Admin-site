import { createHash, timingSafeEqual } from "node:crypto";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminApp, getAdminFirestore } from "@/lib/firebase/admin";
import type { KiwifyWebhookPayload, PurchaseStatus } from "@/types/domain";

const SUPPORTED_EVENTS = new Set(["order_approved", "order_refunded", "chargeback"]);

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

export function inspectClassicPayload(payload: KiwifyWebhookPayload) {
  const expectedStoreId = process.env.KIWIFY_STORE_ID || process.env.KIWIFY_ACCOUNT_ID;
  const expectedProductId = process.env.KIWIFY_PRODUCT_ID;
  const storeId = stringValue(payload.store_id);
  const product = recordValue(payload.Product || payload.product);
  const productId = stringValue(product.product_id || product.productId);
  const eventType = stringValue(payload.webhook_event_type) || stringValue(payload.event) || stringValue(payload.type);
  return {
    store_id: expectedStoreId && storeId && safeEqual(storeId, expectedStoreId) ? "passed" as const : "failed" as const,
    product_id: expectedProductId && productId && safeEqual(productId, expectedProductId) ? "passed" as const : "failed" as const,
    webhook_event_type: eventType ? "passed" as const : "failed" as const,
    event_supported: eventType && SUPPORTED_EVENTS.has(eventType) ? "passed" as const : "failed" as const,
  };
}

export function validateClassicPayload(payload: KiwifyWebhookPayload) {
  if (!process.env.KIWIFY_STORE_ID && !process.env.KIWIFY_ACCOUNT_ID) return { ok: false as const, reason: "store_not_configured" };
  if (!process.env.KIWIFY_PRODUCT_ID) return { ok: false as const, reason: "product_not_configured" };
  const stages = inspectClassicPayload(payload);
  if (stages.store_id === "failed") return { ok: false as const, reason: "store_invalid" };
  if (stages.product_id === "failed") return { ok: false as const, reason: "product_invalid" };
  if (stages.webhook_event_type === "failed" || stages.event_supported === "failed") return { ok: false as const, reason: "event_unsupported" };
  return { ok: true as const };
}

function purchaseStatus(eventType: string): PurchaseStatus | undefined {
  if (eventType === "order_approved") return "approved";
  if (eventType === "order_refunded") return "refunded";
  if (eventType === "chargeback") return "chargeback";
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
  return { eventType, eventId: eventId || `payload:${payloadHash}`, transactionId, email: email?.toLowerCase(), name, productId, amount, payloadHash };
}

async function findOrCreateAuthUser(email: string): Promise<UserRecord> {
  const auth = getAuth(getFirebaseAdminApp());
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    try {
      return await auth.createUser({ email, disabled: false });
    } catch (createError) {
      if ((createError as { code?: string }).code === "auth/email-already-exists") return auth.getUserByEmail(email);
      throw createError;
    }
  }
}

async function findAuthUserForRevocation(email: string | undefined, userId: unknown) {
  const auth = getAuth(getFirebaseAdminApp());
  if (typeof userId === "string" && userId) {
    try { return await auth.getUser(userId); } catch (error) {
      if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    }
  }
  if (!email) return undefined;
  try { return await auth.getUserByEmail(email); } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") return undefined;
    throw error;
  }
}

export function shouldBlockAfterRevocation(
  purchases: Array<{ transactionId?: unknown; productId?: unknown; status?: unknown }>,
  currentTransactionId: string,
  productId: string | undefined,
) {
  return !purchases.some((purchase) =>
    purchase.transactionId !== currentTransactionId
      && purchase.status === "approved"
      && (!productId || purchase.productId === productId));
}

export async function processKiwifyWebhook(payload: KiwifyWebhookPayload, rawBody: string) {
  const normalized = normalizeEvent(payload, rawBody);
  if (!normalized.eventType || !SUPPORTED_EVENTS.has(normalized.eventType)) {
    return { kind: "ignored" as const, eventId: normalized.eventId, reason: "evento não suportado" };
  }
  const eventType = normalized.eventType;
  if (!normalized.transactionId) return { kind: "ignored" as const, eventId: normalized.eventId, reason: "order_id ausente" };

  const firestore = getAdminFirestore();
  const auth = getAuth(getFirebaseAdminApp());
  const eventRef = firestore.collection("webhook_events").doc(normalized.eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 150));
  const purchaseRef = firestore.collection("purchases").doc(normalized.transactionId);
  const existingEvent = await eventRef.get();
  if (existingEvent.exists && existingEvent.data()?.processed === true) return { kind: "duplicate" as const, eventId: normalized.eventId };

  const isApproval = eventType === "order_approved";
  const existingPurchase = await purchaseRef.get();
  const existingUserId = existingPurchase.data()?.userId;
  const authUser = isApproval
    ? normalized.email ? await findOrCreateAuthUser(normalized.email) : undefined
    : await findAuthUserForRevocation(normalized.email, existingUserId);
  if (isApproval && !authUser) return { kind: "ignored" as const, eventId: normalized.eventId, reason: "email do comprador ausente" };

  const result = await firestore.runTransaction(async (transaction) => {
    const currentEvent = await transaction.get(eventRef);
    if (currentEvent.exists && currentEvent.data()?.processed === true) return { kind: "duplicate" as const, shouldDisableAuth: undefined };
    const currentPurchase = await transaction.get(purchaseRef);
    const userId = authUser?.uid;
    const userRef = userId ? firestore.collection("users").doc(userId) : undefined;
    const userSnapshot = userRef ? await transaction.get(userRef) : undefined;
    let shouldDisableAuth: boolean | undefined;

    if (!isApproval && userId) {
      const userPurchases = await transaction.get(firestore.collection("purchases").where("userId", "==", userId));
      const rows = userPurchases.docs.map((doc) => doc.data());
      shouldDisableAuth = shouldBlockAfterRevocation(rows, normalized.transactionId as string, normalized.productId);
    }

    transaction.set(eventRef, {
      eventId: normalized.eventId,
      eventType,
      processed: false,
      receivedAt: FieldValue.serverTimestamp(),
      payloadHash: normalized.payloadHash,
    }, { merge: true });

    if (userRef && userId) {
      const previousUser = userSnapshot?.data();
      transaction.set(userRef, {
        uid: userId,
        email: authUser?.email || normalized.email || previousUser?.email || null,
        role: previousUser?.role === "admin" ? "admin" : "user",
        status: shouldDisableAuth ? "blocked" : "active",
        ...(userSnapshot?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const purchaseData: Record<string, unknown> = {
      transactionId: normalized.transactionId,
      productId: normalized.productId || process.env.KIWIFY_PRODUCT_ID || null,
      status: purchaseStatus(eventType),
      eventType,
      amount: normalized.amount ?? null,
      updatedAt: FieldValue.serverTimestamp(),
      ...(currentPurchase.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      ...(normalized.email ? { customerEmail: normalized.email } : {}),
      ...(normalized.name ? { customerName: normalized.name } : {}),
      ...(userId ? { userId } : {}),
    };
    transaction.set(purchaseRef, purchaseData, { merge: true });
    return { kind: "pending_auth_sync" as const, shouldDisableAuth, userId };
  });

  if (result.kind === "duplicate") return { kind: "duplicate" as const, eventId: normalized.eventId };
  if (result.userId) await auth.updateUser(result.userId, { disabled: result.shouldDisableAuth === true });

  await firestore.runTransaction(async (transaction) => {
    const currentEvent = await transaction.get(eventRef);
    if (currentEvent.exists && currentEvent.data()?.processed !== true) {
      transaction.update(eventRef, { processed: true, processedAt: FieldValue.serverTimestamp() });
    }
  });
  return { kind: "processed" as const, eventId: normalized.eventId };
}
