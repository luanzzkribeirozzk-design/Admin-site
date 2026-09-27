import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('usa as credenciais OAuth2 atuais da Kiwify', async () => {
  const env = await readFile('.env.example', 'utf8');
  assert.match(env, /KIWIFY_CLIENT_ID=/);
  assert.match(env, /KIWIFY_CLIENT_SECRET=/);
  assert.match(env, /KIWIFY_ACCOUNT_ID=/);
  assert.match(env, /KIWIFY_PRODUCT_ID=86fe33a0-ba12-11f1-8dd9-f9841058b646/);
  assert.match(env, /KIWIFY_WEBHOOK_TOKEN=/);
  assert.doesNotMatch(env, /KIWIFY_API_KEY/);
});

test('cliente Kiwify envia client credentials no endpoint OAuth e account id no header', async () => {
  const source = await readFile('lib/kiwify/client.ts', 'utf8');
  assert.match(source, /\/oauth\/token/);
  assert.match(source, /client_id: config\.clientId/);
  assert.match(source, /client_secret: config\.clientSecret/);
  assert.match(source, /x-kiwify-account-id/);
});
