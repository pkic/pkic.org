import {
  badgeCredentialMetadataSchema,
  badgeCredentialsResponseSchema,
  type BadgeCredentialsQuery,
} from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { resolveMappedOrderBy } from "../../db/sort";
import { first } from "../../db/queries";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { eventContactAccessSql } from "./evidence-retention";

/** Personal labels are transient portal data; credential references survive label redaction. */
const projection = `SELECT credential.id,credential.event_id AS eventId,credential.user_id AS userId,
  CASE WHEN person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL AND ${eventContactAccessSql("credential.event_id")}
    THEN NULLIF(TRIM(COALESCE(person.preferred_name,person.first_name,'')||' '||COALESCE(person.last_name,'')),'') ELSE NULL END AS displayName,
  credential.print_credential_json IS NOT NULL AS reprintAvailable,
  credential.created_at AS createdAt,credential.expires_at AS expiresAt,credential.revoked_at AS revokedAt,
  CASE WHEN credential.revoked_at IS NOT NULL THEN 'revoked' WHEN credential.expires_at IS NOT NULL AND credential.expires_at<=? THEN 'expired' ELSE 'active' END AS status
  FROM event_badge_credentials credential JOIN users person ON person.id=credential.user_id`;

export async function listBadgeCredentials(db: DatabaseLike, eventId: string, query: BadgeCredentialsQuery) {
  const fromSql = `FROM (${projection}) badge WHERE badge.eventId=?
    AND (? IS NULL OR badge.userId=?) AND (? IS NULL OR badge.status=?)
    AND INSTR(LOWER(COALESCE(badge.displayName,'')||' '||badge.id),LOWER(?))>0`;
  const results = await db.batch(
    buildOffsetPageStatements(db, {
      source: {
        selectSql:
          "SELECT badge.id,badge.eventId,badge.userId,badge.displayName,badge.createdAt,badge.expiresAt,badge.revokedAt,badge.status,badge.reprintAvailable",
        fromSql,
        bindings: [
          nowIso(),
          eventId,
          query.userId ?? null,
          query.userId ?? null,
          query.status ?? null,
          query.status ?? null,
          query.q ?? "",
        ],
      },
      orderBy: resolveMappedOrderBy(
        query.sort,
        { createdAt: "badge.createdAt", expiresAt: "badge.expiresAt", displayName: "badge.displayName" },
        "badge.createdAt DESC",
        "badge.id ASC",
      ),
      limit: query.limit,
      offset: query.offset,
    }),
  );
  const { rows, total } = decodeOffsetPageResults<Record<string, unknown>>(results[0]!, results[1]!);
  return badgeCredentialsResponseSchema.parse({
    badges: rows.map(parseMetadata),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

export async function getBadgeCredential(db: DatabaseLike, eventId: string, badgeId: string) {
  const row = await first<Record<string, unknown>>(
    db,
    `SELECT badge.id,badge.eventId,badge.userId,badge.displayName,badge.createdAt,badge.expiresAt,badge.revokedAt,badge.status,badge.reprintAvailable FROM (${projection}) badge WHERE badge.eventId=? AND badge.id=?`,
    [nowIso(), eventId, badgeId],
  );
  if (!row) throw new AppError(404, "BADGE_NOT_FOUND", "Badge unavailable.");
  return parseMetadata(row);
}

function parseMetadata(row: Record<string, unknown>) {
  return badgeCredentialMetadataSchema.parse({
    ...row,
    reprintAvailable: row.reprintAvailable === 1 && row.status === "active",
  });
}

/** Reuse the exact contact/redaction projection when releasing a captured display label. */
export function badgeCredentialDisplayEvidence(
  eventId: string,
  badgeId: string,
  displayName: string | null,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM (${projection}) badge WHERE badge.eventId=? AND badge.id=? AND badge.displayName IS ?`,
    bindings: [nowIso(), eventId, badgeId, displayName],
  };
}
