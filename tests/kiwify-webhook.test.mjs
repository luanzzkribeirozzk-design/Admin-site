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
