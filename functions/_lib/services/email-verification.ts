import type { z } from "zod";
import { emailVerificationMethodSchema } from "../../../assets/shared/schemas/organization-representation";
import type { DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";

export type EmailVerificationMethod = z.infer<typeof emailVerificationMethodSchema>;

/** Records proof only when the address that was actually verified is still primary. */
export function prepareVerifyPrimaryEmailStatement(
  db: DatabaseLike,
  input: {
    userId: string;
    normalizedEmail: string;
    method: EmailVerificationMethod;
    verifiedAt?: string;
  },
): StatementLike {
  const verifiedAt = input.verifiedAt ?? nowIso();
  return db
    .prepare(
      `UPDATE users
          SET email_verified_at = ?, email_verification_method = ?, updated_at = ?
        WHERE id = ? AND normalized_email = ?`,
    )
    .bind(verifiedAt, input.method, verifiedAt, input.userId, input.normalizedEmail);
}
