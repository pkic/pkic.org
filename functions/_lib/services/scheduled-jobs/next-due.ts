import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";

/**
 * Resolves the next instant a job has work, so it can sleep until then instead
 * of polling.
 *
 * The result is always capped at the job's own interval, which stays as a
 * low-frequency reconciliation floor: if a producer ever fails to record a
 * deadline, the periodic pass still finds it. That is what keeps the design
 * level-triggered — the computed wake is an optimisation, never the
 * correctness mechanism.
 */
export function boundedNextRunAt(earliestDue: string | null, intervalSeconds: number): string | undefined {
  const floor = new Date(Date.now() + intervalSeconds * 1000).toISOString();
  if (!earliestDue) return floor;
  // Never sleep past the reconciliation floor, and never wake in the past.
  const now = new Date().toISOString();
  const candidate = earliestDue < now ? now : earliestDue;
  return candidate < floor ? candidate : floor;
}

/** Earliest instant at which any retention policy's window elapses. */
export async function earliestRetentionDue(db: DatabaseLike): Promise<string | null> {
  const row = await first<{ due_at: string | null }>(
    db,
    `SELECT MIN(strftime('%Y-%m-%dT%H:%M:%fZ', e.ends_at, '+' || rp.user_retention_days || ' days')) AS due_at
       FROM retention_policies rp
       JOIN events e ON e.id = rp.event_id
      WHERE e.ends_at IS NOT NULL`,
  );
  return row?.due_at ?? null;
}

/** Earliest instant at which an active sponsorship needs a renewal action. */
export async function earliestSponsorshipRenewalDue(db: DatabaseLike): Promise<string | null> {
  const row = await first<{ due_at: string | null }>(
    db,
    `SELECT MIN(renewal_action_due_at) AS due_at
       FROM sponsorships
      WHERE pipeline_stage = 'active' AND renewal_action_due_at IS NOT NULL`,
  );
  return row?.due_at ?? null;
}
