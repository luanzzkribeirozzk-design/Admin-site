import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAuth } from "firebase-admin/auth";
import { getFirebaseAdminApp, getAdminFirestore } from "@/lib/firebase/admin";
import { processKiwifyWebhook, validateClassicPayload } from "@/services/kiwify-webhook";

const TEST_PROJECT_ID = "renda-mobile-test";
const TEST_STORE_ID = "test-store-renda-mobile";
const TEST_PRODUCT_ID = "test-product-renda-mobile";
const TEST_EMAIL = "cliente.teste+renda-mobile@example.test";

function requireEmulators() {
  if (process.env.GCLOUD_PROJECT !== TEST_PROJECT_ID) {
    throw new Error(`Teste abortado: GCLOUD_PROJECT deve ser ${TEST_PROJECT_ID}.`);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
    throw new Error("Teste abortado: FIRESTORE_EMULATOR_HOST não aponta para o Firestore Emulator.");
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
    throw new Error("Teste abortado: FIREBASE_AUTH_EMULATOR_HOST não aponta para o Auth Emulator.");
  }
  for (const name of ["FIREBASE_ADMIN_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_PROJECT_ID"]) {
    if (process.env[name] && process.env[name] !== TEST_PROJECT_ID) {
      throw new Error(`Teste abortado: variável ${name} aponta para um ambiente externo.`);
    }
  }
  for (const name of ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]) {
    if (process.env[name]) throw new Error(`Teste abortado: credencial externa ${name} foi herdada do ambiente.`);
  }
}

requireEmulators();
process.env.FIREBASE_ADMIN_PROJECT_ID = TEST_PROJECT_ID;
process.env.FIREBASE_CLIENT_EMAIL = "test-admin@renda-mobile-test.invalid";
process.env.FIREBASE_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.KIWIFY_STORE_ID = TEST_STORE_ID;
process.env.KIWIFY_PRODUCT_ID = TEST_PRODUCT_ID;

type TestPayload = {
  order_id: string;
  order_status: string;
  store_id: string;
  webhook_event_type: string;
  Product: { product_id: string; product_name: string };
  Customer: { email: string; full_name: string };
  Commissions: { charge_amount: string };
};

const fixture = JSON.parse(readFileSync(new URL("./fixtures/kiwify-order-approved.json", import.meta.url), "utf8")) as TestPayload;

getFirebaseAdminApp();
const auth = getAuth(getFirebaseAdminApp());
const firestore = getAdminFirestore();

function payloadFor(eventType: string, orderId: string): TestPayload {
  return {
    ...fixture,
    order_id: orderId,
    webhook_event_type: eventType,
    Product: { ...fixture.Product, product_id: TEST_PRODUCT_ID },
    Customer: { ...fixture.Customer, email: TEST_EMAIL },
  };
}

function bodyFor(payload: TestPayload) {
  return JSON.stringify(payload);
}

async function readUserDocument(uid: string) {
  return firestore.collection("users").doc(uid).get();
}

async function readPurchase(orderId: string) {
  return firestore.collection("purchases").doc(orderId).get();
}

async function readEvent(orderId: string, eventType: string) {
  return firestore.collection("webhook_events").doc(`${orderId}_${eventType}`).get();
}

test("fluxo completo de acesso Kiwify no Firebase Emulator", async () => {
  assert.deepEqual(validateClassicPayload(fixture), { ok: true });

  const firstPayload = payloadFor("order_approved", "test-order-approved-001");
  const approvedBody = bodyFor(firstPayload);
  const firstApproval = await processKiwifyWebhook(firstPayload, approvedBody);
  assert.equal(firstApproval.kind, "processed");

  const createdAuthUser = await auth.getUserByEmail(TEST_EMAIL);
  const createdUser = (await readUserDocument(createdAuthUser.uid)).data();
  assert.equal(createdUser?.uid, createdAuthUser.uid);
  assert.equal(createdUser?.email, TEST_EMAIL);
  assert.equal(createdUser?.role, "user");
  assert.equal(createdUser?.status, "active");

  const firstPurchase = (await readPurchase("test-order-approved-001")).data();
  assert.equal(firstPurchase?.userId, createdAuthUser.uid);
  assert.equal(firstPurchase?.status, "approved");
  assert.equal(firstPurchase?.productId, TEST_PRODUCT_ID);

  const firstEvent = (await readEvent("test-order-approved-001", "order_approved")).data();
  assert.equal(firstEvent?.eventType, "order_approved");
  assert.equal(firstEvent?.processed, true);

  const duplicate = await processKiwifyWebhook(firstPayload, approvedBody);
  assert.equal(duplicate.kind, "duplicate");
  assert.equal((await auth.getUserByEmail(TEST_EMAIL)).uid, createdAuthUser.uid);

  const secondPayload = payloadFor("order_approved", "test-order-approved-002");
  const secondApproval = await processKiwifyWebhook(secondPayload, bodyFor(secondPayload));
  assert.equal(secondApproval.kind, "processed");
  assert.equal((await auth.getUserByEmail(TEST_EMAIL)).uid, createdAuthUser.uid);

  const refundPayload = payloadFor("order_refunded", "test-order-approved-001");
  const refund = await processKiwifyWebhook(refundPayload, bodyFor(refundPayload));
  assert.equal(refund.kind, "processed");
  assert.equal((await readPurchase("test-order-approved-001")).data()?.status, "refunded");
  assert.equal((await readUserDocument(createdAuthUser.uid)).data()?.status, "active");
  assert.equal((await auth.getUser(createdAuthUser.uid)).disabled, false);

  const chargebackPayload = payloadFor("chargeback", "test-order-approved-002");
  const chargeback = await processKiwifyWebhook(chargebackPayload, bodyFor(chargebackPayload));
  assert.equal(chargeback.kind, "processed");
  assert.equal((await readPurchase("test-order-approved-002")).data()?.status, "chargeback");
  assert.equal((await readUserDocument(createdAuthUser.uid)).data()?.status, "blocked");
  assert.equal((await auth.getUser(createdAuthUser.uid)).disabled, true);

  const reactivationPayload = payloadFor("order_approved", "test-order-approved-003");
  const reactivation = await processKiwifyWebhook(reactivationPayload, bodyFor(reactivationPayload));
  assert.equal(reactivation.kind, "processed");
  assert.equal((await readUserDocument(createdAuthUser.uid)).data()?.status, "active");
  assert.equal((await auth.getUser(createdAuthUser.uid)).disabled, false);
  assert.equal((await readPurchase("test-order-approved-003")).data()?.userId, createdAuthUser.uid);
});
