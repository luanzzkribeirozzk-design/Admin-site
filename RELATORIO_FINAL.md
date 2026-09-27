# Relatório técnico — Renda Mobile Admin + Backend

## Escopo executado

Foi criada a fundação técnica exclusivamente no repositório `Admin-site`. O repositório estava vazio, sem commits anteriores. O `Cliente-site` não foi clonado, acessado ou alterado.

## Arquivos criados

- `app/layout.tsx` e `app/page.tsx`
- `app/api/health/route.ts`
- `app/api/kiwify/webhook/route.ts`
- `lib/firebase/client.ts`
- `lib/firebase/admin.ts`
- `lib/auth/authorization.ts`
- `services/kiwify-webhook.ts`
- `lib/kiwify/client.ts`
- `types/domain.ts`
- `firestore.rules`
- `firestore.indexes.json`
- `.env.example`
- `.gitignore`
- `eslint.config.mjs`
- `tests/kiwify-webhook.test.mjs` e `tests/kiwify-config.test.mjs`
- `package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts`
- `README.md`

## O que foi implementado

- Next.js + TypeScript compatível com Vercel.
- Firebase Web SDK apontando para o projeto real `donos-b59bd`.
- Firebase Admin SDK server-side sem credenciais embutidas no código.
- Variáveis públicas do Web App no `.env.example`.
- Preparação para Firebase Authentication com Email/Password.
- Autorização administrativa server-side verificando token, documento `users`, `role=admin` e `status=active`.
- Regras Firestore sem permissões abertas e sem possibilidade de autoelevação de `role` ou `status`.
- Coleções preparadas: `users`, `purchases`, `webhook_events`, `settings`.
- Endpoint `POST /api/kiwify/webhook`.
- Validação JSON, token do webhook, resposta HTTP adequada, logs sem secrets e tratamento de erro.
- Deduplicação/idempotência em `webhook_events` usando `eventId` ou hash SHA-256 determinístico.
- Eventos iniciais: `compra_aprovada`, `compra_reembolsada` e `chargeback`.
- `KIWIFY_PRODUCT_ID=86fe33a0-ba12-11f1-8dd9-f9841058b646`.
- Health check em `/api/health`.
- Cliente server-side da Kiwify com OAuth2: `client_id` e `client_secret` são enviados ao endpoint `/v1/oauth/token`; o token Bearer retornado é usado junto ao header `x-kiwify-account-id`.
- Lint explícito e não interativo com ESLint.

## Variáveis necessárias na Vercel

Públicas/client:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Server-side:

- `KIWIFY_CLIENT_ID` — `client_id` da nova API Key criada na Kiwify.
- `KIWIFY_CLIENT_SECRET` — `client_secret` da nova API Key criada na Kiwify.
- `KIWIFY_ACCOUNT_ID` — `account_id` da conta Kiwify.
- `KIWIFY_PRODUCT_ID=86fe33a0-ba12-11f1-8dd9-f9841058b646`.
- `KIWIFY_WEBHOOK_TOKEN` — token da configuração do webhook Kiwify.
- `FIREBASE_ADMIN_PROJECT_ID=donos-b59bd`.
- `FIREBASE_CLIENT_EMAIL` — Service Account do Firebase.
- `FIREBASE_PRIVATE_KEY` — chave privada da Service Account.

Nenhum secret foi colocado no código, no `.env.example` ou no Git.

## URL esperada após deploy

```text
https://SEU-DOMINIO-VERCEL.vercel.app/api/kiwify/webhook
```

A URL não foi cadastrada na Kiwify, conforme solicitado.

## Testes executados

- `npm install`: concluído.
- `npm run typecheck`: passou.
- `npm test`: 4 testes passaram.
- `npm run lint`: passou.
- `npm run build`: passou; rotas geradas para `/`, `/api/health` e `/api/kiwify/webhook`.
- Verificação de ausência de `.env.local`, Service Account local e diretório Cliente-site: passou.

## Erros encontrados e corrigidos

1. O script inicial `next lint` abriu um configurador interativo/depreciado. Foi substituído por ESLint explícito com configuração flat.
2. `eslint-config-next` foi inicialmente instalado em versão incompatível com o Next.js do projeto; as versões foram alinhadas.
3. O lint identificou arquivo gerado e import não utilizado; ambos foram corrigidos.

O `npm install` reportou 10 vulnerabilidades transitivas (9 moderadas e 1 alta). Elas não foram corrigidas automaticamente para evitar alterações potencialmente incompatíveis; devem ser auditadas antes do deploy.

## Configuração manual posterior

1. Inserir as variáveis server-side na Vercel.
2. Publicar `firestore.rules` no projeto `donos-b59bd`.
3. Criar o primeiro administrador por procedimento seguro no Firebase Console/Admin SDK.
4. Fazer deploy do Admin-site.
5. Criar uma nova API Key na Kiwify e copiar `client_id`, `client_secret` e `account_id` diretamente para as Environment Variables da Vercel.
6. Testar a autenticação OAuth e o endpoint com o token e os logs de teste da Kiwify.
7. Só depois cadastrar o webhook na Kiwify.

A criação automática de usuários reais e a ativação final de acesso devem ser conectadas ao payload real validado da Kiwify em uma etapa posterior; não foram criados usuários, compras ou eventos fictícios.
