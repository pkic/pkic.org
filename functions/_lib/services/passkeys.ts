/**
 * Passkey credential read model shared by the registration, authentication,
 * and listing use cases. The ceremonies live in passkey-registration.ts and
 * passkey-authentication.ts; revocation lives in passkey-revocation.ts.
 */
import { all } from "../db/queries";
import { MAX_PASSKEY_CREDENTIALS_PER_USER } from "../../../assets/shared/constants/passkeys";
import type { DatabaseLike } from "../types";

export const PASSKEY_CREDENTIAL_COLUMNS =
  "id, user_id, credential_id, public_key, sign_count, aaguid, device_name, last_used_at, created_at, revoked_at";

export interface PasskeyCredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  aaguid: string | null;
  device_name: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface PasskeySummary {
  id: string;
  deviceName: string | null;
  aaguid: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function toSummary(row: PasskeyCredentialRow): PasskeySummary {
  return {
    id: row.id,
    deviceName: row.device_name,
    aaguid: row.aaguid,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export async function listPasskeysForUser(db: DatabaseLike, userId: string): Promise<PasskeySummary[]> {
  const rows = await all<PasskeyCredentialRow>(
    db,
    `SELECT ${PASSKEY_CREDENTIAL_COLUMNS}
     FROM passkey_credentials
     WHERE user_id = ? AND revoked_at IS NULL
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [userId, MAX_PASSKEY_CREDENTIALS_PER_USER],
  );
  return rows.map(toSummary);
}
