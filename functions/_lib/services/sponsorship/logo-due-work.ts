import { all, first } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import type { DatabaseLike } from "../../types";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { SITE_PUBLICATION_SITE_RESOURCE_ID } from "../../../../assets/shared/schemas/site-publication-requests";

/** Each due marker and its publication request commit together; the publication outbox owns retries. */
export async function runSponsorLogoDueWork(db: DatabaseLike, at: string, limit = 50, budget?: D1QueryBudget) {
  const boundedLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  if (!boundedLimit || !hasD1QueryCapacity(budget, 2)) return { expired: 0, archived: 0 };
  const due = await all<{ id: string; logo_action_due_at: string; transition_revision: number }>(
    db,
    `SELECT id,logo_action_due_at,transition_revision FROM sponsorships WHERE logo_action_due_at IS NOT NULL
     AND logo_action_due_at<=? ORDER BY logo_action_due_at,id LIMIT ?`,
    [at, boundedLimit],
  );
  const result = { expired: 0, archived: 0 };
  for (const row of due) {
    if (!hasD1QueryCapacity(budget, 3)) break;
    try {
      await db.batch([
        db
          .prepare(`UPDATE sponsorships SET logo_action_due_at=NULL,transition_revision=transition_revision+1
          WHERE id=? AND logo_action_due_at=? AND transition_revision=?`)
          .bind(row.id, row.logo_action_due_at, row.transition_revision),
        prepareAuditLogAfterOneChange(
          db,
          "system",
          null,
          "sponsorship_logo_grace_ended",
          "sponsorship",
          row.id,
          {},
          at,
        ),
        prepareSitePublicationRequest(db, {
          resourceType: "sponsorship",
          resourceId: row.id,
          revision: Date.parse(at),
          reasonCode: "sponsorship_changed",
          deduplicationKey: `sponsor-logo-expiry:${row.id}:${row.logo_action_due_at}`,
        }),
      ]);
      result.expired++;
    } catch (error) {
      if (!isAuditChangeGuardFailure(error)) throw error;
    }
  }
  if (!hasD1QueryCapacity(budget, 1)) return result;
  const events = await all<{ id: string; ends_at: string }>(
    db,
    `SELECT id,ends_at FROM events
    WHERE ends_at<=? AND NOT EXISTS(SELECT 1 FROM sponsor_event_archives archive
      WHERE archive.event_id=events.id AND archive.ended_at=events.ends_at)
    ORDER BY ends_at,id LIMIT ?`,
    [at, boundedLimit],
  );
  for (const event of events) {
    if (!hasD1QueryCapacity(budget, 3)) break;
    try {
      await db.batch([
        db
          .prepare(`INSERT INTO sponsor_event_archives(event_id,ended_at,published_at)
          SELECT id,ends_at,? FROM events WHERE id=? AND ends_at=? AND ends_at<=?
          ON CONFLICT(event_id,ended_at) DO NOTHING`)
          .bind(at, event.id, event.ends_at, at),
        prepareAuditLogAfterOneChange(db, "system", null, "sponsor_event_archived", "event", event.id, {}, at),
        prepareSitePublicationRequest(db, {
          resourceType: "site_content",
          resourceId: SITE_PUBLICATION_SITE_RESOURCE_ID,
          revision: Date.parse(at),
          reasonCode: "sponsorship_changed",
          deduplicationKey: `sponsor-event-archive:${event.id}:${event.ends_at}`,
        }),
      ]);
      result.archived++;
    } catch (error) {
      if (!isAuditChangeGuardFailure(error)) throw error;
    }
  }
  return result;
}

export async function earliestSponsorLogoDue(db: DatabaseLike): Promise<string | null> {
  const row = await first<{ at: string | null }>(
    db,
    `SELECT MIN(at) AS at FROM (
    SELECT MIN(logo_action_due_at) AS at FROM sponsorships WHERE logo_action_due_at IS NOT NULL
    UNION ALL SELECT MIN(ends_at) FROM events WHERE NOT EXISTS(SELECT 1 FROM sponsor_event_archives archive
      WHERE archive.event_id=events.id AND archive.ended_at=events.ends_at))`,
  );
  return row?.at ?? null;
}
