import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = () => readFile('app/admin-shell.tsx', 'utf8');

test('cada seção da sidebar possui renderização explícita', async () => {
  const text = await source();
  for (const section of ['dashboard', 'users', 'purchases', 'content', 'categories', 'prompts', 'tools', 'challenges', 'notices', 'integration', 'settings']) {
    assert.match(text, new RegExp(`section === "${section}"|section as Resource`));
  }
  assert.match(text, /setData\(null\)/);
});

test('modal CRUD usa estado explícito e fecha por X e Cancelar', async () => {
  const text = await source();
  assert.match(text, /const \[modalOpen, setModalOpen\]/);
  assert.match(text, /\{modalOpen &&/);
  assert.match(text, /aria-label="Fechar modal"/);
  assert.match(text, /type="button" className="button ghost" onClick=\{closeModal\}/);
});

test('Avisos usa select para tipo/prioridade e checkbox para ativo', async () => {
  const text = await source();
  assert.match(text, /key: "type", label: "Tipo", type: "select"/);
  assert.match(text, /key: "priority", label: "Prioridade", type: "select"/);
  assert.match(text, /key: "active", label: "Ativo", type: "checkbox"/);
  assert.match(text, /type="checkbox"/);
  assert.match(text, /<select/);
});

test('geração de login cliente permanece restrita a role user', async () => {
  const [ui, api] = await Promise.all([source(), readFile('app/api/admin/route.ts', 'utf8')]);
  assert.match(ui, /Gerar login cliente/);
  assert.match(ui, /resource: "users"/);
  assert.match(api, /const password = `Rm!\$\{randomBytes\(18\)/);
  assert.match(api, /role: "user"/);
  assert.doesNotMatch(api, /role: "admin"/);
});
