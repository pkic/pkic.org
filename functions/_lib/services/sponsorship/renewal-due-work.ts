import { getConfig } from "../../config";
import { all } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { prepareQueueEmailStatement } from "../../email/outbox";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { resolveRenewalAction, utcDate, type ResolvedSponsorshipRenewalAction } from "./renewal-policy";
import { prepareSponsorshipStageTransition } from "./stage-transition";

const REMINDER_NOTES = {
  "reminder-60": "Renewal reminder sent (60 days)",
  "reminder-30": "Renewal reminder sent (30 days)",
} as const;

interface SponsorshipDueWorkRow {
  id: string;
  sponsor_type: string;
  organization_id: string | null;
  organization_name: string | null;
  non_member_name: string | null;
  contact_name: string | null;
  tier: string | null;
  pipeline_stage: string;
  transition_revision: number;
  renewal_date: string;
  renewal_action_due_at: string;
  assigned_to_user_id: string | null;
  assigned_to_email: string | null;
}

export const SPONSORSHIP_DUE_WORK_QUERY = `
  SELECT sp.id, sp.sponsor_type, sp.organization_id, o.name AS organization_name,
         sp.non_member_name, sp.contact_name, sp.tier, sp.pipeline_stage,
         sp.transition_revision, sp.renewal_date, sp.renewal_action_due_at,
         sp.assigned_to_user_id, u.email AS assigned_to_email
  FROM sponsorships sp INDEXED BY idx_sponsorships_active_renewal_action_due
  LEFT JOIN organizations o ON o.id = sp.organization_id
  LEFT JOIN users u ON u.id = sp.assigned_to_user_id
  WHERE sp.pipeline_stage = 'active'
    AND sp.renewal_action_due_at IS NOT NULL
    AND sp.renewal_action_due_at <= ?
  ORDER BY sp.renewal_action_due_at ASC, sp.id ASC
  LIMIT ?`;

function sponsorName(row: SponsorshipDueWorkRow): string {
  return row.organization_name ?? row.non_member_name ?? row.contact_name ?? "Sponsor";
}

async function stableOutboxId(operationKey: string): Promise<string> {
  return (await sha256Hex(operationKey)).slice(0, 32);
}

async function prepareReminderStatements(
  db: DatabaseLike,
  row: SponsorshipDueWorkRow,
  action: ResolvedSponsorshipRenewalAction & { action: "reminder-60" | "reminder-30" },
  now: string,
  adminUrl: string,
): Promise<StatementLike[]> {
  if (!row.assigned_to_email) return [];
  const operationKey = `sponsorship:${row.id}:${action.effectKey}`;
  const templateKey = `sponsorship-renewal-${action.action}`;
  const reminderDays = action.action === "reminder-60" ? 60 : 30;
  return [
    db
      .prepare(
        `UPDATE sponsorships
         SET renewal_action_due_at = ?, updated_at = ?, transition_revision = transition_revision + 1
         WHERE id = ?
           AND pipeline_stage = 'active'
           AND transition_revision = ?
           AND renewal_date = ?
           AND renewal_action_due_at = ?
           AND assigned_to_user_id = ?`,
      )
      .bind(
        action.nextActionDueAt,
        now,
        row.id,
        row.transition_revision,
        row.renewal_date,
        row.renewal_action_due_at,
        row.assigned_to_user_id,
      ),
    prepareAuditLogAfterOneChange(
      db,
      "system",
      null,
      "sponsorship_renewal_reminder_queued",
      "sponsorship",
      row.id,
      { effectKey: action.effectKey, renewalDate: row.renewal_date, recipientEmail: row.assigned_to_email },
      now,
    ),
    db
      .prepare(
        `INSERT INTO sponsorship_automation_effects (sponsorship_id, effect_key, created_at)
         VALUES (?, ?, ?)`,
      )
      .bind(row.id, action.effectKey, now),
    db
      .prepare(
        `INSERT INTO sponsorship_events
           (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, 'active', 'active', NULL, ?, ?)`,
      )
      .bind(uuid(), row.id, REMINDER_NOTES[action.action], now),
    prepareQueueEmailStatement(
      db,
      {
        outboxId: await stableOutboxId(operationKey),
        idempotencyKey: operationKey,
        templateKey,
        recipientEmail: row.assigned_to_email,
        messageType: "transactional",
        subject: `Sponsorship renewal due in ${reminderDays} days: ${sponsorName(row)}`,
        data: {
          organizationName: sponsorName(row),
          tier: row.tier,
          renewalDate: row.renewal_date,
          adminUrl,
        },
      },
      now,
    ).statement,
  ];
}

export interface SponsorshipDueWorkResult {
  reminders60Sent: number;
  reminders30Sent: number;
  autoLapsed: number;
}

const SPONSORSHIP_SELECTION_STATEMENTS = 1;
const SPONSORSHIP_MAX_ACTION_STATEMENTS = 6;

export async function runSponsorshipDueWork(
  db: DatabaseLike,
  env: Env,
  limit = 100,
  d1QueryBudget?: D1QueryBudget,
): Promise<SponsorshipDueWorkResult> {
  const result: SponsorshipDueWorkResult = { reminders60Sent: 0, reminders30Sent: 0, autoLapsed: 0 };
  const requestedLimit = Math.max(0, Math.min(500, Math.floor(limit)));
  if (requestedLimit === 0) return result;
  const budgetBoundedLimit = d1QueryBudget
    ? Math.floor(
        Math.max(0, d1QueryBudget.remainingQueries() - SPONSORSHIP_SELECTION_STATEMENTS) /
          SPONSORSHIP_MAX_ACTION_STATEMENTS,
      )
    : requestedLimit;
  const boundedLimit = Math.min(requestedLimit, budgetBoundedLimit);
  if (boundedLimit < 1) return result;

  const today = utcDate();
  const rows = await all<SponsorshipDueWorkRow>(db, SPONSORSHIP_DUE_WORK_QUERY, [today, boundedLimit]);
  const config = getConfig(env);

  for (const row of rows) {
    const action = resolveRenewalAction(
      { pipelineStage: row.pipeline_stage, renewalDate: row.renewal_date, assignedToUserId: row.assigned_to_user_id },
      today,
    );
    if (!action) continue;
    const now = nowIso();

    if (action.action === "auto-lapse") {
      const transition = prepareSponsorshipStageTransition(db, row, {
        toStage: "lapsed",
        actor: null,
        note: "Auto-lapsed — renewal date passed with no renewal action",
        auditAction: "sponsorship_auto_lapsed",
        now,
        expectedRenewal: { renewalDate: row.renewal_date, actionDueAt: row.renewal_action_due_at },
      });
      const statements: StatementLike[] = [
        ...transition.statements,
        db
          .prepare(
            `INSERT INTO sponsorship_automation_effects (sponsorship_id, effect_key, created_at)
             VALUES (?, ?, ?)`,
          )
          .bind(row.id, action.effectKey, now),
      ];
      if (row.assigned_to_email) {
        const operationKey = `sponsorship:${row.id}:${action.effectKey}:staff-notification`;
        statements.push(
          prepareQueueEmailStatement(
            db,
            {
              outboxId: await stableOutboxId(operationKey),
              idempotencyKey: operationKey,
              templateKey: "sponsorship-lapsed-staff",
              recipientEmail: row.assigned_to_email,
              messageType: "transactional",
              subject: `Sponsorship lapsed: ${sponsorName(row)}`,
              data: {
                organizationName: sponsorName(row),
                tier: row.tier,
                renewalDate: row.renewal_date,
                adminUrl: `${config.appBaseUrl}/admin/#/sponsorships/${row.id}`,
              },
            },
            now,
          ).statement,
        );
      }
      if (!hasD1QueryCapacity(d1QueryBudget, statements.length)) break;
      try {
        await db.batch(statements);
        result.autoLapsed += 1;
      } catch (error) {
        if (!isAuditOneChangeGuardFailure(error)) throw error;
      }
      continue;
    }

    const statements = await prepareReminderStatements(
      db,
      row,
      action,
      now,
      `${config.appBaseUrl}/admin/#/sponsorships/${row.id}`,
    );
    if (statements.length === 0) continue;
    if (!hasD1QueryCapacity(d1QueryBudget, statements.length)) break;
    try {
      await db.batch(statements);
      if (action.action === "reminder-60") result.reminders60Sent += 1;
      else result.reminders30Sent += 1;
    } catch (error) {
      if (!isAuditOneChangeGuardFailure(error)) throw error;
    }
  }

  return result;
}
