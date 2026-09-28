# Renda Mobile — Admin + Backend

Fundação técnica do repositório **Admin-site**. O `Cliente-site` não faz parte deste repositório e não foi alterado.

## Arquitetura

- Next.js + TypeScript, compatível com Vercel.
- Firebase Web SDK para autenticação/Firestore no cliente.
- Firebase Admin SDK somente no servidor, com credenciais por variáveis de ambiente.
- Cloud Firestore como banco exclusivo.
- Endpoint `POST /api/kiwify/webhook/<segredo>` dentro do próprio projeto.
- Coleções previstas: `users`, `purchases`, `webhook_events`, `settings`.

## Configuração local

```bash
cp .env.example .env.local
npm install
npm run typecheck
npm run build
npm test
npm run dev
```

O `.env.local` deve receber as credenciais privadas apenas localmente. A configuração real de `KIWIFY_CLIENT_ID`, `KIWIFY_CLIENT_SECRET`, `KIWIFY_ACCOUNT_ID`, `KIWIFY_WEBHOOK_TOKEN`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` é uma **CONFIGURAÇÃO POSTERIOR** na Vercel. O `client_secret` e o token OAuth nunca são usados no frontend.

## Variáveis na Vercel

| Variável | Onde | Valor/origem |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | client | valor público do Web App `admin` existente |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | client | `donos-b59bd.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | client | `donos-b59bd` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | client | `donos-b59bd.firebasestorage.app` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | client | `710702057831` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | client | `1:710702057831:web:6081977da8669787eac7c2` |
| `KIWIFY_PRODUCT_ID` | server | `86fe33a0-ba12-11f1-8dd9-f9841058b646` |
| `KIWIFY_CLIENT_ID` | server | `client_id` da nova API Key criada na Kiwify |
| `KIWIFY_CLIENT_SECRET` | server | `client_secret` da nova API Key criada na Kiwify |
| `KIWIFY_ACCOUNT_ID` | server | `account_id` exibido pela Kiwify |
| `KIWIFY_WEBHOOK_TOKEN` | server | token gerado/fornecido na configuração do webhook Kiwify |
| `FIREBASE_ADMIN_PROJECT_ID` | server | `donos-b59bd` |
| `FIREBASE_CLIENT_EMAIL` | server | Service Account do projeto Firebase |
| `FIREBASE_PRIVATE_KEY` | server | chave privada da Service Account, com `\\n` preservado |

Nunca publique Service Account, API Key, token ou `.env` no GitHub.

### Autenticação atual da Kiwify

A API oficial usa OAuth2. O backend envia `client_id` e `client_secret` como `application/x-www-form-urlencoded` para `POST https://public-api.kiwify.com/v1/oauth/token`. A resposta contém um Bearer token temporário. O `account_id` não é enviado para gerar o token; ele é enviado nas chamadas autenticadas subsequentes pelo header `x-kiwify-account-id`, junto de `Authorization: Bearer <token>`. O cliente server-side mantém o token em cache apenas durante a execução do processo e respeita sua expiração. A documentação informa expiração de 96 horas na visão geral e a resposta OAuth informa `expires_in`; o código usa o valor retornado pela API.

O código não usa mais `KIWIFY_API_KEY`, não solicita nem reutiliza a API Key excluída e não expõe nenhuma credencial em respostas HTTP.

## Firebase

1. No Firebase Console, confirmar o projeto `donos-b59bd` e o app Web `admin`.
2. Confirmar Authentication > Email/Password habilitado.
3. Publicar `firestore.rules` e, se necessário, `firestore.indexes.json`.
4. Criar o primeiro administrador por procedimento controlado no Firebase Console/Admin SDK. O frontend nunca pode promover um usuário: as regras preservam `role` e `status` para usuários comuns.

As regras não utilizam `allow read, write: if true`. O Admin SDK ignora regras do cliente e deve ser protegido exclusivamente por variáveis server-side.

## Webhook Kiwify

A URL esperada após o deploy é a URL secreta configurada na Kiwify:

```text
https://SEU-DOMINIO-VERCEL.vercel.app/api/kiwify/webhook/SEU_SEGREDO
```

A rota aceita `POST` JSON somente no caminho secreto, valida `store_id`, `Product.product_id` e `webhook_event_type`, calcula hash do payload, registra `webhook_events` e processa apenas uma vez cada `order_id:event_type`. Os eventos de entrega reconhecidos são `order_approved`, `order_refunded` e `chargeback`; `billet_created` não libera acesso.

A documentação oficial consultada da Kiwify descreve webhooks JSON, configuração por produto/evento e os gatilhos `compra_aprovada`, `compra_reembolsada` e `chargeback`; o payload clássico observado usa `order_approved`, `order_refunded` e `chargeback` em `webhook_event_type`. O backend usa uma URL secreta como proteção adicional, sem registrar o segredo.

### Acesso do cliente

Em `order_approved`, o backend localiza ou cria o usuário no Firebase Authentication pelo e-mail, cria/ativa `users/{uid}` com `role: "user"` e `status: "active"`, e grava `purchases/{order_id}` com `userId` e status `approved`. Em `order_refunded` ou `chargeback`, atualiza a compra e só bloqueia o usuário quando não há outra compra aprovada do mesmo produto; nesse caso também define `disabled: true` no Firebase Authentication. O processamento é idempotente e mantém eventos pendentes se a sincronização do Authentication falhar, permitindo reprocessamento seguro.

**Não cadastrar o webhook na Kiwify ainda.** Primeiro faça deploy, teste a rota e só então cadastre a URL real.

Teste sem dados fictícios de produção, usando o botão de teste/logs da Kiwify ou um payload de teste controlado:

Não use payload inventado para liberar acesso. Faça o teste pelo webhook real de uma venda aprovada ou pelo reenvio de um evento real aprovado da Kiwify.

Não use esse exemplo para criar vendas reais; remova registros de teste se algum ambiente real for utilizado.

## O que ainda é configuração manual

- Inserir secrets na Vercel.
- Publicar as Security Rules no projeto Firebase correto.
- Criar/promover o primeiro admin por canal seguro.
- Fazer deploy do Admin-site.
- Confirmar o payload real nos logs de teste da Kiwify.
- Só depois cadastrar o webhook na Kiwify.
- Construir o painel visual e as rotas CRUD futuras.

## Estado desta etapa

Criados: configuração Next/TypeScript, Firebase client/Admin, autorização administrativa, health check, webhook, serviços, tipos, regras, índices, `.env.example`, `.gitignore`, testes e esta documentação.

Modificados: nenhum arquivo preexistente — o repositório estava vazio.

Não alterado: `Cliente-site` (não foi clonado nem acessado).
