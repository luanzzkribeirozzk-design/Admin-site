import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('webhook clássico usa segredo de caminho e não token do payload', async () => {
  const text = await readFile('services/kiwify-webhook.ts', 'utf8');
  assert.match(text, /KIWIFY_WEBHOOK_PATH_SECRET/);
  assert.match(text, /validateClassicPayload/);
  assert.match(text, /KIWIFY_STORE_ID/);
  assert.match(text, /KIWIFY_ACCOUNT_ID/);
  assert.match(text, /KIWIFY_PRODUCT_ID/);
  assert.match(text, /timingSafeEqual/);
  assert.doesNotMatch(text, /payload\.token/);
  assert.match(text, /order_approved/);
  assert.match(text, /order_refunded/);
  assert.match(text, /chargeback/);
  assert.doesNotMatch(text, /billet_created/);
  assert.doesNotMatch(text, /compra_aprovada/);
});

test('aprovação sincroniza Firebase Authentication, users e purchases', async () => {
  const text = await readFile('services/kiwify-webhook.ts', 'utf8');
  assert.match(text, /getUserByEmail/);
  assert.match(text, /createUser/);
  assert.match(text, /email-already-exists/);
  assert.match(text, /collection\("users"\)/);
  assert.match(text, /status: shouldDisableAuth \? "blocked" : "active"/);
  assert.match(text, /userId \? \{ userId \}/);
});

test('reembolso e chargeback bloqueiam somente quando não há outra compra aprovada', async () => {
  const text = await readFile('services/kiwify-webhook.ts', 'utf8');
  assert.match(text, /shouldBlockAfterRevocation/);
  assert.match(text, /where\("userId", "==", userId\)/);
  assert.match(text, /purchase\.status === "approved"/);
  assert.match(text, /updateUser\(result\.userId, \{ disabled: result\.shouldDisableAuth === true \}/);
});

test('idempotência permanece antes e depois da sincronização Auth', async () => {
  const text = await readFile('services/kiwify-webhook.ts', 'utf8');
  assert.match(text, /processed === true/);
  assert.match(text, /processed: false/);
  assert.match(text, /processedAt: FieldValue\.serverTimestamp/);
});

test('rota secreta não registra o segredo no diagnóstico', async () => {
  const text = await readFile('app/api/kiwify/webhook/[secret]/route.ts', 'utf8');
  assert.match(text, /webhook\/\[secret\]/);
  assert.doesNotMatch(text, /secret[^\n]*saveDiagnostic/);
  assert.doesNotMatch(text, /console\.(log|info).*secret/);
});

test('o projeto não deve conter credenciais de servidor no exemplo', async () => {
  const text = await readFile('.env.example', 'utf8');
  assert.match(text, /KIWIFY_CLIENT_SECRET=/);
  assert.match(text, /KIWIFY_ACCOUNT_ID=/);
  assert.doesNotMatch(text, /sk_live|service_account|private_key_id/i);
});
