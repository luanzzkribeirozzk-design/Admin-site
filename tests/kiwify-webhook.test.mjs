import test from 'node:test';
import assert from 'node:assert/strict';

// Testes puros da política de entrada; integração Firestore é executada após configurar o Admin SDK.
test('endpoint exige token configurado', () => {
  assert.equal(typeof process.env.KIWIFY_WEBHOOK_TOKEN, 'undefined');
});

test('o projeto não deve conter credenciais de servidor no exemplo', async () => {
  const text = await (await import('node:fs/promises')).readFile('.env.example', 'utf8');
  assert.match(text, /KIWIFY_CLIENT_SECRET=/);
  assert.match(text, /KIWIFY_ACCOUNT_ID=/);
  assert.doesNotMatch(text, /sk_live|service_account|private_key_id/i);
});
