import { sha256Hex } from "../../functions/_lib/utils/crypto";
import { nowIso, addHours } from "../../functions/_lib/utils/time";
import type { DatabaseLike } from "../../functions/_lib/types";

export async function createAdminSession(db: DatabaseLike, adminUserId: string, rawToken: string): Promise<void> {
  const tokenHash = await sha256Hex(rawToken);
  await db
    .prepare(
      `
    INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
    VALUES ('${crypto.randomUUID()}', '${adminUserId}', '${tokenHash}', '${addHours(nowIso(), 8)}', NULL, '${nowIso()}');
  `,
    )
    .run();
}
