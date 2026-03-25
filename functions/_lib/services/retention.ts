import { all, run } from "../db/queries";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";

interface RetentionPolicyRow {
  event_id: string;
  user_retention_days: number;
}

interface EventEndRow {
  id: string;
  name: string;
  slug: string;
  ends_at: string | null;
}

export interface RetentionPreviewEvent {
  eventId: string;
  eventName: string;
  eventSlug: string;
  endsAt: string | null;
  retentionDays: number;
  eligibleRegistrations: number;
  eligibleUsers: number;
}

function olderThanDays(isoDate: string, days: number): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(isoDate).getTime() < cutoff;
}

/**
 * Retention scope: events/registrations/users ONLY.
 *
 * The `donations` table is explicitly excluded from all retention processing.
 * Donor PII and financial data must be retained for ≥7 years per IRS §6001.
 */
async function getRetentionPreviewEvents(db: DatabaseLike): Promise<RetentionPreviewEvent[]> {
  const policies = await all<RetentionPolicyRow>(db, "SELECT * FROM retention_policies");
  if (policies.length === 0) {
    return [];
  }

  const dueEvents: RetentionPreviewEvent[] = [];
  for (const policy of policies) {
    const event = await all<EventEndRow>(db, "SELECT id, name, slug, ends_at FROM events WHERE id = ?", [policy.event_id]);
    if (event.length === 0 || !event[0].ends_at) {
      continue;
    }

    if (!olderThanDays(event[0].ends_at, policy.user_retention_days)) {
      continue;
    }

    const counts = await all<{ registrations: number; users: number }>(
      db,
      `SELECT
         COUNT(*) AS registrations,
         COUNT(DISTINCT user_id) AS users
       FROM registrations
       WHERE event_id = ?`,
      [policy.event_id],
    );

    dueEvents.push({
      eventId: policy.event_id,
      eventName: event[0].name,
      eventSlug: event[0].slug,
      endsAt: event[0].ends_at,
      retentionDays: policy.user_retention_days,
      eligibleRegistrations: Number(counts[0]?.registrations ?? 0),
      eligibleUsers: Number(counts[0]?.users ?? 0),
    });
  }

  return dueEvents;
}

export async function summarizeRetentionJob(db: DatabaseLike): Promise<{
  dueEvents: RetentionPreviewEvent[];
  totalEvents: number;
  totalRegistrations: number;
  totalUsers: number;
}> {
  const dueEvents = await getRetentionPreviewEvents(db);
  return {
    dueEvents,
    totalEvents: dueEvents.length,
    totalRegistrations: dueEvents.reduce((sum, item) => sum + item.eligibleRegistrations, 0),
    totalUsers: dueEvents.reduce((sum, item) => sum + item.eligibleUsers, 0),
  };
}

export async function runRetentionJob(db: DatabaseLike): Promise<{
  redactedRegistrations: number;
  redactedUsers: number;
  affectedEvents: number;
}> {
  const dueEvents = await getRetentionPreviewEvents(db);
  if (dueEvents.length === 0) {
    return { redactedRegistrations: 0, redactedUsers: 0, affectedEvents: 0 };
  }

  let redactedRegistrations = 0;
  let redactedUsers = 0;
  let affectedEvents = 0;

  for (const dueEvent of dueEvents) {
    affectedEvents += 1;

    await run(
      db,
      `UPDATE registrations
       SET custom_answers_json = NULL,
           source_ref = NULL,
           updated_at = ?
       WHERE event_id = ?`,
      [nowIso(), dueEvent.eventId],
    );

    await run(
      db,
      `UPDATE users
       SET first_name = NULL,
           last_name = NULL,
           preferred_name = NULL,
           organization_name = NULL,
           job_title = NULL,
           biography = NULL,
           links_json = NULL,
           data_json = NULL,
           pii_redacted_at = ?,
           updated_at = ?
       WHERE id IN (
         SELECT user_id FROM registrations WHERE event_id = ?
       )`,
      [nowIso(), nowIso(), dueEvent.eventId],
    );

    redactedRegistrations += dueEvent.eligibleRegistrations;
    redactedUsers += dueEvent.eligibleUsers;
  }

  return { redactedRegistrations, redactedUsers, affectedEvents };
}
