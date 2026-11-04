import { scannerCapabilities } from "../../../../assets/shared/event-scanner-permissions";
import { scannerAttendeeBadgeResponseSchema } from "../../../../assets/shared/schemas/event-scanner-lookup";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { readEventAdminResource } from "../events/authorized-context";
import { eventReadIdSql } from "../events/selection";
import { activeReprintableBadgeWhereSql } from "./badge-lifecycle";
import { recoverBadgeCredential, type BadgePrintEnvironment } from "./badge-print-protection";
import { badgeAttendeeEligibilitySql, prepareBadgeAttendees } from "./badge-attendees";
import { scannerCaptureOpenForEventSql } from "./scanner-upload-receipts";
import { nowIso } from "../../utils/time";

type LookupEnvironment = Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;
const permissions = ["agenda:scan", ...scannerCapabilities] as const;

/** Search, event ownership and live human authorization share one bounded replica snapshot. */
export async function readScannerAttendees(
  db: DatabaseLike,
  request: Request,
  env: LookupEnvironment,
  slug: string,
  query: unknown,
) {
  const read = await prepareBadgeAttendees(db, { slug }, query);
  return readEventAdminResource(db, request, env, slug, permissions, () => read);
}

/** Resolve one selected existing badge under the canonical read-side authorization/replication policy. */
export function readScannerAttendeeBadge(
  db: DatabaseLike,
  request: Request,
  env: LookupEnvironment & BadgePrintEnvironment,
  slug: string,
  userId: string,
) {
  return readEventAdminResource(db, request, env, slug, permissions, (event) => {
    const scope = eventReadIdSql(event);
    const statement = db
      .prepare(`SELECT badge.id,badge.credential_hash,badge.print_credential_json
      FROM event_badge_credentials badge JOIN registrations reg ON reg.event_id=badge.event_id AND reg.user_id=badge.user_id JOIN users u ON u.id=reg.user_id
      WHERE ${activeReprintableBadgeWhereSql("badge", scope.sql, "?", "?")}
        AND ${badgeAttendeeEligibilitySql("reg", "u")} AND ${scannerCaptureOpenForEventSql("badge.event_id")}
      ORDER BY badge.created_at DESC,badge.id DESC LIMIT 1`)
      .bind(...scope.bindings, userId, nowIso());
    return {
      statements: [statement],
      async decode(results, owner) {
        const row = batchFirst<{ id: string; credential_hash: string; print_credential_json: string }>(results[0]!);
        if (!row)
          throw new AppError(
            409,
            "SCANNER_BADGE_UNAVAILABLE",
            "No active badge is available. Ask the registration desk for help.",
          );
        const badgeId = await recoverBadgeCredential(
          env,
          { eventId: owner.id, id: row.id, userId, credentialHash: row.credential_hash },
          row.print_credential_json,
        );
        return scannerAttendeeBadgeResponseSchema.parse({ badgeId });
      },
    };
  });
}
