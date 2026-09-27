export type UserRole = "admin" | "user";
export type UserStatus = "active" | "blocked";
export type PurchaseStatus = "approved" | "refunded" | "chargeback";
export type KiwifyEventType = "compra_aprovada" | "compra_reembolsada" | "chargeback" | string;

export interface KiwifyWebhookPayload {
  id?: string;
  event_id?: string;
  type?: KiwifyEventType;
  event?: KiwifyEventType;
  token?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}
