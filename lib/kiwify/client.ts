const KIWIFY_API_BASE_URL = "https://public-api.kiwify.com/v1";
const TOKEN_SAFETY_WINDOW_MS = 60_000;

type KiwifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number | string;
  scope?: string;
};

type TokenCache = { accessToken: string; expiresAt: number };
let tokenCache: TokenCache | undefined;

export function getKiwifyConfig() {
  const clientId = process.env.KIWIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.KIWIFY_CLIENT_SECRET?.trim();
  const accountId = process.env.KIWIFY_ACCOUNT_ID?.trim();
  const productId = process.env.KIWIFY_PRODUCT_ID?.trim();
  const missing = [
    ["KIWIFY_CLIENT_ID", clientId],
    ["KIWIFY_CLIENT_SECRET", clientSecret],
    ["KIWIFY_ACCOUNT_ID", accountId],
    ["KIWIFY_PRODUCT_ID", productId],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) throw new Error(`Configuração Kiwify ausente: ${missing.join(", ")}`);
  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    accountId: accountId as string,
    productId: productId as string,
  };
}

export function isKiwifyApiConfigured() {
  return Boolean(
    process.env.KIWIFY_CLIENT_ID?.trim()
      && process.env.KIWIFY_CLIENT_SECRET?.trim()
      && process.env.KIWIFY_ACCOUNT_ID?.trim()
      && process.env.KIWIFY_PRODUCT_ID?.trim(),
  );
}

async function getAccessToken() {
  const config = getKiwifyConfig();
  if (tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS) return tokenCache.accessToken;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const response = await fetch(`${KIWIFY_API_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Falha na autenticação OAuth da Kiwify (HTTP ${response.status})`);
  }
  const token = await response.json() as Partial<KiwifyTokenResponse>;
  if (!token.access_token || token.token_type?.toLowerCase() !== "bearer") {
    throw new Error("Resposta OAuth da Kiwify inválida");
  }
  const expiresInSeconds = Number(token.expires_in);
  tokenCache = {
    accessToken: token.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 86_400_000),
  };
  return token.access_token;
}

export async function kiwifyRequest<T>(path: string, init: RequestInit = {}) {
  const config = getKiwifyConfig();
  const accessToken = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("x-kiwify-account-id", config.accountId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(`${KIWIFY_API_BASE_URL}${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) throw new Error(`Kiwify API respondeu HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
