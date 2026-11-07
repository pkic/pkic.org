import type { DatabaseLike, StatementLike } from "../types";
import {
  emailAddressDeliverySchema,
  UNKNOWN_EMAIL_DELIVERY,
  type EmailAddressDelivery,
} from "../../../assets/shared/schemas/email-address-delivery";
import { parseJsonSafe } from "../utils/json";

/**
 * Durable event watermarks belong to the address, never its delivery queue.
 * Separate maxima preserve unresolved hard failures across temporary outcomes,
 * even when webhooks arrive out of order; only a later delivery resolves them.
 */
export const DELIVERY_COLUMNS = [
  "delivery_bounced_at",
  "delivery_blocked_at",
  "delivery_delayed_at",
  "delivery_delivered_at",
] as const;
export type AddressDeliveryRow = Record<(typeof DELIVERY_COLUMNS)[number], string | null>;

/** Internal table aliases only; no message or audit history participates in this projection. */
export function emailAddressDeliveryJsonSql(address: string): string {
  const delivered = `${address}.delivery_delivered_at`;
  const signals = [
    ["bouncing", "delivery_bounced_at"],
    ["blocked", "delivery_blocked_at"],
    ["delayed", "delivery_delayed_at"],
  ] as const;
  const unresolved = (column: string) =>
    `${address}.${column} IS NOT NULL AND (${delivered} IS NULL OR ${address}.${column} >= ${delivered})`;
  return `json_object('status', CASE ${signals.map(([status, column]) => `WHEN ${unresolved(column)} THEN '${status}'`).join(" ")} WHEN ${delivered} IS NOT NULL THEN 'delivered' ELSE 'unknown' END,
    'observedAt', CASE ${signals.map(([, column]) => `WHEN ${unresolved(column)} THEN ${address}.${column}`).join(" ")} ELSE ${delivered} END)`;
}

export function decodeEmailAddressDelivery(json: string | null | undefined): EmailAddressDelivery {
  return emailAddressDeliverySchema.parse(parseJsonSafe<unknown>(json ?? "", UNKNOWN_EMAIL_DELIVERY));
}

/** Transfer a guarded address snapshot inside its owning atomic mutation. */
export function prepareAddressDeliveryTransfer(
  db: DatabaseLike,
  table: "users" | "user_emails",
  id: string,
  delivery: AddressDeliveryRow,
): StatementLike {
  return db
    .prepare(`UPDATE ${table} SET ${DELIVERY_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`)
    .bind(...DELIVERY_COLUMNS.map((column) => delivery[column]), id);
}
