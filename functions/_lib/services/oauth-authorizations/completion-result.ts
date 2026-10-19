import type { DatabaseLike } from "../../types";
import { guardUserSessionDatabase, type OwnAccount } from "../../auth/member";
import { first } from "../../db/queries";
import { getOwnedOauthAuthorization } from "./read-model";
import { openOauthRedirect } from "./completion-payload";
import { oauthAuthorizationCompletionSchema } from "../../../../assets/shared/schemas/oauth-authorizations";

/** Only the approving person may recover the short-lived encrypted callback. */
export async function readOauthCompletionResult(db: DatabaseLike, account: OwnAccount, id: string, secret: string) {
  db = guardUserSessionDatabase(db, account);
  const authorization = await getOwnedOauthAuthorization(db, account.userId, id);
  if (["revoked", "failed", "expired"].includes(authorization.status))
    return oauthAuthorizationCompletionSchema.parse({ status: authorization.status });
  const completion = await first<{ status: string; attemptUntil: string; redirectCiphertext: string | null }>(
    db,
    `SELECT status,attempt_until AS attemptUntil,redirect_ciphertext AS redirectCiphertext
    FROM oauth_authorization_completions WHERE authorization_id=?`,
    [id],
  );
  if (!completion || Date.parse(completion.attemptUntil) <= Date.now())
    return oauthAuthorizationCompletionSchema.parse({ status: "expired" });
  if (authorization.status === "active" && completion.status === "completed" && completion.redirectCiphertext)
    return oauthAuthorizationCompletionSchema.parse({
      status: "active",
      redirectTo: await openOauthRedirect(completion.redirectCiphertext, secret, id),
    });
  return oauthAuthorizationCompletionSchema.parse({ status: completion.status === "failed" ? "failed" : "pending" });
}
