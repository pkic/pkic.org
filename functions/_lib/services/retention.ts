import { all, run } from "../db/queries";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";

interface RetentionPolicyRow {
  event_id: string;
  user_retention_days: number;
}

interface EventEndRow {
  id: string;
  ends_at: string | null;
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
export async function runRetentionJob(db: DatabaseLike): Promise<{ redactedRegistrations: number }> {
  const policies = await all<RetentionPolicyRow>(db, "SELECT * FROM retention_policies");
  if (policies.length === 0) {
    return { redactedRegistrations: 0 };
  }

  let redacted = 0;
  for (const policy of policies) {
    const event = await all<EventEndRow>(db, "SELECT id, ends_at FROM events WHERE id = ?", [policy.event_id]);
    if (event.length === 0 || !event[0].ends_at) {
      continue;
    }

    if (!olderThanDays(event[0].ends_at, policy.user_retention_days)) {
      continue;
    }

    await run(
      db,
      `UPDATE registrations
       SET custom_answers_json = NULL,
           source_ref = NULL,
           updated_at = ?
       WHERE event_id = ?`,
      [nowIso(), policy.event_id],
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
      [nowIso(), nowIso(), policy.event_id],
    );

    const row = await all<{ total: number }>(
      db,
      "SELECT COUNT(*) AS total FROM registrations WHERE event_id = ?",
      [policy.event_id],
    );

    redacted += Number(row[0]?.total ?? 0);
  }

  return { redactedRegistrations: redacted };
}
