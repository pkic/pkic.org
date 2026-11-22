import { z } from "zod";
import { databaseIdSchema } from "../../../assets/shared/schemas/identifiers";
import { first } from "../db/queries";
import type { DatabaseLike } from "../types";
import { AppError } from "../errors";
import { accountAddressSignsInSql, liveAccountSql } from "../auth/email-sign-in-policy";
export const emailDeliveryGuardSchema = z
  .object({ id: databaseIdSchema, version: z.number().int().nonnegative() })
  .strict();
/** Infrastructure consumes a declarative database policy, without importing domain services. */
export async function validateEmailDeliveryGuard(db: DatabaseLike, payload: Record<string, unknown>) {
  if (payload.__currentRecipient !== undefined) {
    const recipient = z
      .object({ userId: databaseIdSchema, email: z.string().email(), requireCurrentPrimary: z.boolean().optional() })
      .strict()
      .safeParse(payload.__currentRecipient);
    if (!recipient.success)
      throw new AppError(409, "CAPABILITY_RESOURCE_STALE", "This notification is no longer deliverable.");
    // Still one of the person's addresses: the primary (under its proof rule), or a verified added one,
    // which mail about a record made as an identity may go to.
    const email = recipient.data.email.toLowerCase();
    const currentRecipient = recipient.data.requireCurrentPrimary
      ? await first<{ id: string }>(
          db,
          `SELECT person.id FROM (SELECT ? AS normalized_email) recipient
           JOIN users person ON person.id = ? AND ${liveAccountSql("person")}
             AND person.normalized_email = recipient.normalized_email
             AND ${accountAddressSignsInSql("person.id", "recipient.normalized_email")}`,
          [email, recipient.data.userId],
        )
      : await first<{ id: string }>(
          db,
          `SELECT id FROM users WHERE id = ? AND active = 1 AND (
        (normalized_email = ? AND (email_verified_at IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM user_emails WHERE user_id = users.id AND verified_at IS NOT NULL
        )))
        OR EXISTS (SELECT 1 FROM user_emails added
          WHERE added.user_id = users.id AND added.normalized_email = ? AND added.verified_at IS NOT NULL))`,
          [recipient.data.userId, email, email],
        );
    if (!currentRecipient)
      throw new AppError(409, "CAPABILITY_RESOURCE_STALE", "This notification is no longer deliverable.");
  }
  if (payload.__deliveryGuard === undefined) return;
  const parsed = emailDeliveryGuardSchema.safeParse(payload.__deliveryGuard);
  if (!parsed.success)
    throw new AppError(409, "CAPABILITY_RESOURCE_STALE", "This notification is no longer deliverable.");
  const current = await first<{ deliverable: number }>(
    db,
    "SELECT deliverable FROM email_delivery_guard_states WHERE id=? AND version=?",
    [parsed.data.id, parsed.data.version],
  );
  if (current?.deliverable !== 1)
    throw new AppError(409, "CAPABILITY_RESOURCE_STALE", "This notification is no longer deliverable.");
}
