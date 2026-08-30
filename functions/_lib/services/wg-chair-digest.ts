/** Weekly, retry-safe working-group membership-change digest. */
import { batchRows } from "../db/pagination";
import { prepareBulkQueueEmailChunkStatements, processSelectedOutbox, type BulkEmailQueueRow } from "../email/outbox";
import { getConfig } from "../config";
import type { DatabaseLike, Env } from "../types";
import { sha256Hex } from "../utils/crypto";
import { CURRENT_GROUP_LEADERSHIP_CTES_SQL, GROUP_LEAD_ROLE_ID } from "./group-leadership-query";

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const DIGEST_BOUNDARY_HOUR_UTC = 8;
const DIGEST_TEMPLATE_KEY = "wg-chair-membership-digest";

interface WgChangeRow {
  working_group_id: string;
  working_group_name: string;
  membership_id: string;
  change_type: "joined" | "left";
  changed_at: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
}

interface WgRecipientRow {
  working_group_id: string;
  recipient_user_id: string;
  recipient_email: string;
  recipient_first_name: string | null;
  recipient_last_name: string | null;
  recipient_role: "chair" | "vice chair";
}

interface WgChangeEntry {
  name: string;
  organizationName: string | null;
}

interface WgDigestRecipient {
  userId: string;
  email: string;
  name: string;
  role: "chair" | "vice chair";
}

interface WgDigestGroup {
  id: string;
  name: string;
  joined: WgChangeEntry[];
  left: WgChangeEntry[];
  recipients: WgDigestRecipient[];
}

export interface WgChairDigestWindow {
  start: string;
  end: string;
  key: string;
}

export interface WgChairDigestResult {
  workingGroupsWithChanges: number;
  /** Legacy field name: number of new durable outbox rows inserted by this run. */
  emailsSent: number;
}

export interface QueuedWgChairDigest extends WgChairDigestResult {
  outboxIds: string[];
}

/** Resolve the most recently completed Monday 08:00 UTC weekly window. */
export function resolveWgChairDigestWindow(now: Date = new Date()): WgChairDigestWindow {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("Invalid WG chair digest run time");
  }

  const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
  let endMs = Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate() - daysSinceMonday,
    DIGEST_BOUNDARY_HOUR_UTC,
  );
  if (instant.getTime() < endMs) {
    endMs -= WEEK_MS;
  }

  const end = new Date(endMs).toISOString();
  return {
    start: new Date(endMs - WEEK_MS).toISOString(),
    end,
    key: end,
  };
}

const CHANGE_EVENTS_CTE_SQL = `
  change_events AS (
    SELECT membership.id AS membership_id, membership.group_id AS working_group_id, membership.user_id,
           'joined' AS change_type, membership.joined_at AS changed_at
      FROM group_memberships membership
     WHERE membership.joined_at >= ? AND membership.joined_at < ?
    UNION ALL
    SELECT membership.id AS membership_id, membership.group_id AS working_group_id, membership.user_id,
           'left' AS change_type, membership.left_at AS changed_at
      FROM group_memberships membership
     WHERE membership.left_at IS NOT NULL AND membership.left_at >= ? AND membership.left_at < ?
  )
`;

/** Exact production change-row query, exported for D1 query-plan regression coverage. */
export const WG_CHAIR_DIGEST_CHANGE_EVENTS_QUERY = `WITH ${CHANGE_EVENTS_CTE_SQL}
  SELECT wg.id AS working_group_id, wg.name AS working_group_name,
         ce.membership_id, ce.change_type, ce.changed_at,
         u.first_name, u.last_name, o.name AS organization_name
    FROM change_events ce
    JOIN groups wg ON wg.id = ce.working_group_id AND wg.active = 1
    JOIN users u ON u.id = ce.user_id
    JOIN members m ON m.id = ce.membership_id
    LEFT JOIN organizations o ON o.id = m.organization_id
   ORDER BY wg.name, wg.id, ce.changed_at, ce.membership_id, ce.change_type`;

function windowBindings(window: WgChairDigestWindow): unknown[] {
  return [window.start, window.end, window.start, window.end];
}

async function readDigestRows(
  db: DatabaseLike,
  window: WgChairDigestWindow,
): Promise<{ changes: WgChangeRow[]; recipients: WgRecipientRow[] }> {
  const [changeResult, recipientResult] = await db.batch([
    db.prepare(WG_CHAIR_DIGEST_CHANGE_EVENTS_QUERY).bind(...windowBindings(window)),
    db
      .prepare(
        `WITH ${CHANGE_EVENTS_CTE_SQL},
              changed_groups AS (
                SELECT DISTINCT working_group_id FROM change_events
              ),
              ${CURRENT_GROUP_LEADERSHIP_CTES_SQL}
         SELECT leadership.group_id AS working_group_id,
                leadership.user_id AS recipient_user_id,
                u.email AS recipient_email,
                u.first_name AS recipient_first_name,
                u.last_name AS recipient_last_name,
                CASE
                  WHEN MAX(CASE WHEN leadership.role_id = '${GROUP_LEAD_ROLE_ID}' THEN 1 ELSE 0 END) = 1
                    THEN 'chair'
                  ELSE 'vice chair'
                END AS recipient_role
           FROM changed_groups changed
           JOIN groups wg ON wg.id = changed.working_group_id AND wg.active = 1
           JOIN current_group_leadership leadership
             ON leadership.group_id = changed.working_group_id
           JOIN users u ON u.id = leadership.user_id
          WHERE u.active = 1
            AND u.email <> ''
            AND CASE
                  WHEN u.notification_preferences_json IS NULL
                    OR json_valid(u.notification_preferences_json) = 0
                    THEN 1
                  ELSE COALESCE(
                    json_extract(u.notification_preferences_json, '$.wgChairMembershipDigest'),
                    1
                  )
                END = 1
          GROUP BY leadership.group_id, leadership.user_id,
                   u.email, u.first_name, u.last_name
          ORDER BY leadership.group_id, leadership.user_id`,
      )
      .bind(...windowBindings(window)),
  ]);

  return {
    changes: batchRows<WgChangeRow>(changeResult),
    recipients: batchRows<WgRecipientRow>(recipientResult),
  };
}

function toChangeEntry(row: WgChangeRow): WgChangeEntry {
  return {
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    organizationName: row.organization_name,
  };
}

function groupDigestRows(changes: WgChangeRow[], recipients: WgRecipientRow[]): WgDigestGroup[] {
  const groups = new Map<string, WgDigestGroup>();
  for (const change of changes) {
    const group = groups.get(change.working_group_id) ?? {
      id: change.working_group_id,
      name: change.working_group_name,
      joined: [],
      left: [],
      recipients: [],
    };
    group[change.change_type].push(toChangeEntry(change));
    groups.set(change.working_group_id, group);
  }

  for (const recipient of recipients) {
    const group = groups.get(recipient.working_group_id);
    if (!group) continue;
    group.recipients.push({
      userId: recipient.recipient_user_id,
      email: recipient.recipient_email,
      name:
        [recipient.recipient_first_name, recipient.recipient_last_name].filter(Boolean).join(" ") ||
        recipient.recipient_email,
      role: recipient.recipient_role,
    });
  }
  return [...groups.values()];
}

async function buildOutboxRows(groups: WgDigestGroup[], window: WgChairDigestWindow): Promise<BulkEmailQueueRow[]> {
  return Promise.all(
    groups.flatMap((group) =>
      group.recipients.map(async (recipient) => {
        const idempotencyKey = `${DIGEST_TEMPLATE_KEY}:${window.key}:${group.id}:${recipient.userId}`;
        return {
          outboxId: (await sha256Hex(idempotencyKey)).slice(0, 32),
          idempotencyKey,
          eventId: null,
          templateKey: DIGEST_TEMPLATE_KEY,
          recipientUserId: recipient.userId,
          recipientEmail: recipient.email,
          messageType: "transactional" as const,
          subject: `${group.name} — weekly membership update`,
          data: {
            workingGroupName: group.name,
            recipientName: recipient.name,
            recipientRole: recipient.role,
            windowStart: window.start,
            windowEnd: window.end,
            joined: group.joined,
            left: group.left,
          },
        };
      }),
    ),
  );
}

/** Read one closed weekly window and idempotently persist all digest messages. */
export async function queueWeeklyWgChairDigest(db: DatabaseLike, now: Date = new Date()): Promise<QueuedWgChairDigest> {
  const window = resolveWgChairDigestWindow(now);
  const { changes, recipients } = await readDigestRows(db, window);
  const groups = groupDigestRows(changes, recipients);
  const rows = await buildOutboxRows(groups, window);
  const chunks = prepareBulkQueueEmailChunkStatements(db, rows, now.toISOString());
  const results = chunks.length ? await db.batch(chunks.map((chunk) => chunk.statement)) : [];

  return {
    workingGroupsWithChanges: groups.length,
    emailsSent: results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0),
    outboxIds: chunks.flatMap((chunk) => chunk.ids),
  };
}

export async function runWeeklyWgChairDigest(
  db: DatabaseLike,
  env: Env,
  now: Date = new Date(),
): Promise<WgChairDigestResult> {
  const queued = await queueWeeklyWgChairDigest(db, now);
  // Bound immediate delivery within the scheduled invocation's D1 budget.
  // Remaining durable rows are picked up by the normal outbox processor.
  const immediateDeliveryLimit = Math.max(0, getConfig(env).scheduledOutboxLimit);
  const immediateDeliveryIds = queued.outboxIds.slice(0, immediateDeliveryLimit);
  await processSelectedOutbox(db, env, immediateDeliveryIds);
  return {
    workingGroupsWithChanges: queued.workingGroupsWithChanges,
    emailsSent: queued.emailsSent,
  };
}
