import { prepareSitePublicationRequestSelection } from "./site-publication-requests";
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "./people/profile-publication-sql";
import { publicGroupProfileIdentityPredicate } from "./groups/profile-publication";
import { livePersonHeadshotSql } from "./live-session/live-person-photo";
import { PUBLIC_MEMBER_USER_SOURCE_SQL } from "./membership/public-profile-sql";
import { all } from "../db/queries";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";
import { prepareAffiliationRedactionStatements } from "./identities/affiliation-redaction";

export interface RetentionPreviewEvent {
  eventId: string;
  eventName: string;
  eventSlug: string;
  endsAt: string;
  retentionDays: number;
  eligibleRegistrations: number;
  eligibleUsers: number;
}

interface RetentionPreviewRow {
  event_id: string;
  event_name: string;
  event_slug: string;
  ends_at: string;
  retention_days: number;
  eligible_registrations: number;
  eligible_users: number;
  total_events: number;
  total_registrations: number;
  total_users: number;
}

export const DUE_RETENTION_PREDICATE = `
  e.ends_at IS NOT NULL
  AND datetime(e.ends_at) < datetime('now', '-' || rp.user_retention_days || ' days')
`;

const DUE_RETENTION_USER_IDS_SQL = `
  SELECT r.user_id
    FROM registrations r
    JOIN retention_policies rp ON rp.event_id = r.event_id
    JOIN events e ON e.id = rp.event_id
   WHERE ${DUE_RETENTION_PREDICATE}`;

/**
 * One set-based D1 read replaces the former policy loop (event lookup plus
 * count query per policy). Window aggregates return the summary from the
 * same snapshot without a second scan or Worker-side reduction.
 */
async function getRetentionPreviewRows(db: DatabaseLike): Promise<RetentionPreviewRow[]> {
  return all<RetentionPreviewRow>(
    db,
    `WITH due_events AS (
       SELECT rp.event_id, e.name AS event_name, e.slug AS event_slug, e.ends_at,
              rp.user_retention_days AS retention_days,
              COUNT(r.id) AS eligible_registrations,
              COUNT(DISTINCT r.user_id) AS eligible_users
       FROM retention_policies rp
       JOIN events e ON e.id = rp.event_id
       LEFT JOIN registrations r ON r.event_id = e.id
       WHERE ${DUE_RETENTION_PREDICATE}
       GROUP BY rp.event_id, e.name, e.slug, e.ends_at, rp.user_retention_days
     )
     SELECT event_id, event_name, event_slug, ends_at, retention_days,
            eligible_registrations, eligible_users,
            COUNT(*) OVER () AS total_events,
            SUM(eligible_registrations) OVER () AS total_registrations,
            SUM(eligible_users) OVER () AS total_users
     FROM due_events
     ORDER BY ends_at ASC, event_id ASC`,
  );
}

function toPreview(row: RetentionPreviewRow): RetentionPreviewEvent {
  return {
    eventId: row.event_id,
    eventName: row.event_name,
    eventSlug: row.event_slug,
    endsAt: row.ends_at,
    retentionDays: Number(row.retention_days),
    eligibleRegistrations: Number(row.eligible_registrations),
    eligibleUsers: Number(row.eligible_users),
  };
}

/**
 * Retention scope: events/registrations/users ONLY.
 *
 * The `donations` table is explicitly excluded. Donor PII and financial data
 * must be retained for at least seven years per IRS section 6001.
 */
export async function summarizeRetentionJob(db: DatabaseLike): Promise<{
  dueEvents: RetentionPreviewEvent[];
  totalEvents: number;
  totalRegistrations: number;
  totalUsers: number;
}> {
  const rows = await getRetentionPreviewRows(db);
  const totals = rows[0];
  return {
    dueEvents: rows.map(toPreview),
    totalEvents: Number(totals?.total_events ?? 0),
    totalRegistrations: Number(totals?.total_registrations ?? 0),
    totalUsers: Number(totals?.total_users ?? 0),
  };
}

export async function runRetentionJob(db: DatabaseLike): Promise<{
  redactedRegistrations: number;
  redactedUsers: number;
  affectedEvents: number;
}> {
  const previewRows = await getRetentionPreviewRows(db);
  const totals = previewRows[0];
  if (!totals) {
    return { redactedRegistrations: 0, redactedUsers: 0, affectedEvents: 0 };
  }

  const now = nowIso();
  await db.batch([
    prepareSitePublicationRequestSelection(
      db,
      {
        resourceType: "user_profile",
        revision: Date.parse(now),
        reasonCode: "user_profile_changed",
        deduplicationKey: `retention:${crypto.randomUUID()}`,
      },
      {
        sql: `WITH due_users AS (${DUE_RETENTION_USER_IDS_SQL})
        SELECT person.id AS resource_id ${PUBLIC_MEMBER_USER_SOURCE_SQL}
        AND person.id IN (SELECT user_id FROM due_users)
        AND (NULLIF(person.first_name,'') IS NOT NULL OR NULLIF(person.last_name,'') IS NOT NULL
          OR NULLIF(${livePersonHeadshotSql("person")},'') IS NOT NULL
          OR (identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
            AND ((identity.organization_id IS NOT NULL AND identity.job_title IS NOT NULL)
              OR identity.biography IS NOT NULL
              OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(identity.links_json) THEN identity.links_json ELSE '[]' END)))))
        UNION ALL SELECT person.id AS resource_id ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL}
          AND person.id IN (SELECT user_id FROM due_users)
        UNION ALL SELECT holder.id AS resource_id FROM users holder JOIN identities held ON held.user_id=holder.id
          WHERE holder.id IN (SELECT user_id FROM due_users)
            AND (NULLIF(holder.first_name,'') IS NOT NULL OR NULLIF(holder.last_name,'') IS NOT NULL
              OR NULLIF(${livePersonHeadshotSql("holder")},'') IS NOT NULL
              OR (held.organization_id IS NOT NULL AND held.job_title IS NOT NULL)
              OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(held.links_json) THEN held.links_json ELSE '[]' END)))
            AND ${publicGroupProfileIdentityPredicate("held")}`,
        bindings: [],
      },
    ),
    db
      .prepare(
        `UPDATE registrations
         SET custom_answers_json = NULL, source_ref = NULL, updated_at = ?
         WHERE EXISTS (
           SELECT 1
           FROM retention_policies rp
           JOIN events e ON e.id = rp.event_id
           WHERE rp.event_id = registrations.event_id
             AND ${DUE_RETENTION_PREDICATE}
         )`,
      )
      .bind(now),
    db
      .prepare(
        `UPDATE users
         SET first_name = NULL, last_name = NULL, preferred_name = NULL,
             data_json = NULL, pii_redacted_at = ?, updated_at = ?
         WHERE EXISTS (
           SELECT 1
           FROM registrations r
           JOIN retention_policies rp ON rp.event_id = r.event_id
           JOIN events e ON e.id = rp.event_id
           WHERE r.user_id = users.id
             AND ${DUE_RETENTION_PREDICATE}
         )`,
      )
      .bind(now, now),
    ...prepareAffiliationRedactionStatements(db, DUE_RETENTION_USER_IDS_SQL, [], now),
  ]);

  return {
    redactedRegistrations: Number(totals.total_registrations),
    redactedUsers: Number(totals.total_users),
    affectedEvents: Number(totals.total_events),
  };
}
