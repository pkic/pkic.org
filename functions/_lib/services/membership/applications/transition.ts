/**
 * Membership application stage machine. Split out of the former
 * member-applications.ts (PR #1 review §1.5).
 *
 * Replicates the GitHub label state machine as explicit transitions.
 * `approved` is deliberately not a destination here — reaching it requires
 * the full onboarding orchestration in approveApplication() (approve.ts),
 * not just a status flip, so it's excluded from this generic transition
 * function to make that impossible to bypass.
 */
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { AppError } from "../../../errors";
import { prepareQueueEmailStatement, type QueueEmailPayload } from "../../../email/outbox";
import { prepareAuditLog } from "../../audit";
import { ON_HOLD_SUBTYPES, allowedTransitions } from "../../../../../assets/shared/schemas/member-applications";
import { getMemberApplicationById, type MemberApplicationRow } from "./queries";
import type { ApplicationStage } from "./create";
import type { DatabaseLike, StatementLike } from "../../../types";

export { ON_HOLD_SUBTYPES, allowedTransitions };
export type OnHoldSubtype = (typeof ON_HOLD_SUBTYPES)[number];
const ON_HOLD_SUBTYPE_SET = new Set<string>(ON_HOLD_SUBTYPES);

export const ON_HOLD_SUBTYPE_EMAIL_TEMPLATES: Record<OnHoldSubtype, string> = {
  request_authority: "application-hold-authority",
  request_org_email: "application-hold-org-email",
  request_pki_experience: "application-hold-pki-experience",
  request_org_application: "application-hold-org-application",
  request_information: "application-hold-information",
};

const STAGE_EMAIL_TEMPLATES: Partial<Record<string, string>> = {
  in_consultation: "application-in-consultation",
  declined: "application-declined",
};

export function isValidStageTransition(fromStage: string, toStage: string): boolean {
  const allowed = allowedTransitions(fromStage as ApplicationStage) ?? [];
  return allowed.includes(toStage as ApplicationStage);
}

export interface StageTransitionResult {
  application: MemberApplicationRow;
  fromStage: string;
  toStage: string;
  /** Applicant template selected by the stage machine, if any. */
  suggestedEmailTemplateKey: string | null;
  /** Outbox rows committed in the same batch as the transition. */
  outboxIds: string[];
}

export interface StageTransitionNotification {
  statusUrl: string;
  deadlineDays: number;
  consultationWindowDays: number;
  requestDetails?: string;
  reason?: string;
}

export interface StageTransitionParams {
  applicationId: string;
  toStage: string;
  actorUserId: string | null;
  onHoldSubtype?: string | null;
  note?: string | null;
  notification?: StageTransitionNotification;
  email?: QueueEmailPayload;
}

export interface PreparedStageTransition {
  statements: StatementLike[];
  result: StageTransitionResult;
}

/**
 * Builds the complete atomic write set for a previously loaded application.
 * Batch jobs use this to combine several transitions with one aggregate
 * notification without reimplementing the stage machine.
 */
export function prepareApplicationStageTransition(
  db: DatabaseLike,
  application: MemberApplicationRow,
  params: StageTransitionParams,
): PreparedStageTransition {
  if (application.id !== params.applicationId) {
    throw new AppError(500, "APPLICATION_ID_MISMATCH", "Loaded application does not match transition request");
  }

  if (!isValidStageTransition(application.stage, params.toStage)) {
    throw new AppError(
      409,
      "INVALID_STAGE_TRANSITION",
      `Cannot transition from '${application.stage}' to '${params.toStage}'`,
    );
  }

  if (params.toStage === "on_hold" && !ON_HOLD_SUBTYPE_SET.has(params.onHoldSubtype ?? "")) {
    throw new AppError(422, "ON_HOLD_SUBTYPE_REQUIRED", "A valid on_hold subtype is required");
  }

  const now = nowIso();
  const nextOnHoldSubtype = params.toStage === "on_hold" ? (params.onHoldSubtype as string) : null;
  const fromStage = application.stage;

  const suggestedEmailTemplateKey =
    params.toStage === "on_hold"
      ? ON_HOLD_SUBTYPE_EMAIL_TEMPLATES[params.onHoldSubtype as OnHoldSubtype]
      : (STAGE_EMAIL_TEMPLATES[params.toStage] ?? null);

  const stageEmail =
    suggestedEmailTemplateKey && params.notification
      ? {
          templateKey: suggestedEmailTemplateKey,
          recipientEmail: application.applicant_email,
          messageType: "transactional" as const,
          subject: "Update on your PKI Consortium membership application",
          data: {
            applicantName: application.applicant_name,
            statusUrl: params.notification.statusUrl,
            deadlineDays: params.notification.deadlineDays,
            consultationWindowDays: params.notification.consultationWindowDays,
            requestDetails: params.notification.requestDetails ?? "",
            reason: params.notification.reason ?? "",
          },
        }
      : null;
  const email = params.email ?? stageEmail;
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE member_applications
         SET status = ?, stage = ?, stage_entered_at = ?, on_hold_subtype = ?, updated_at = ?
         WHERE id = ? AND stage = ?`,
      )
      .bind(params.toStage, params.toStage, now, nextOnHoldSubtype, now, application.id, fromStage),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?, ?, ?)`,
      )
      .bind(uuid(), application.id, fromStage, params.toStage, params.actorUserId, params.note ?? null, now),
  ];

  const outboxIds: string[] = [];
  if (email) {
    const preparedEmail = prepareQueueEmailStatement(db, email, now);
    statements.push(preparedEmail.statement);
    outboxIds.push(preparedEmail.id);
  }
  statements.push(
    prepareAuditLog(
      db,
      params.actorUserId ? "admin" : "system",
      params.actorUserId,
      "application_stage_transitioned",
      "member_application",
      application.id,
      { fromStage, toStage: params.toStage, onHoldSubtype: nextOnHoldSubtype },
      now,
    ),
  );

  return {
    statements,
    result: {
      application: {
        ...application,
        status: params.toStage,
        stage: params.toStage,
        stage_entered_at: now,
        on_hold_subtype: nextOnHoldSubtype,
        updated_at: now,
      },
      fromStage,
      toStage: params.toStage,
      suggestedEmailTemplateKey,
      outboxIds,
    },
  };
}

/**
 * Applies a stage transition: validates it against the state machine,
 * updates `status`/`stage`/`stage_entered_at` (kept in sync, matching
 * createMemberApplication's convention), writes a member_application_events
 * row, audit row, and any durable email intent in one D1 batch. Delivery is
 * still owned by the caller after commit; this use case only owns the outbox
 * insert required for atomicity.
 */
export async function transitionApplicationStage(
  db: DatabaseLike,
  params: StageTransitionParams,
): Promise<StageTransitionResult> {
  const application = await getMemberApplicationById(db, params.applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const fromStage = application.stage;
  const prepared = prepareApplicationStageTransition(db, application, params);

  let results: Awaited<ReturnType<DatabaseLike["batch"]>>;
  try {
    results = await db.batch(prepared.statements);
  } catch (error) {
    const current = await getMemberApplicationById(db, application.id);
    if (current && current.stage !== fromStage) {
      throw new AppError(
        409,
        "STAGE_TRANSITION_CONFLICT",
        `Application stage changed concurrently; expected '${fromStage}'`,
      );
    }
    throw error;
  }

  if ((results[0]?.meta?.changes ?? 0) === 0) {
    throw new AppError(
      409,
      "STAGE_TRANSITION_CONFLICT",
      `Application stage changed concurrently; expected '${fromStage}'`,
    );
  }

  return prepared.result;
}
