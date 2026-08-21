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
import { prepareReleaseApplicationDomainClaim } from "../organization-domain-claims";
import {
  ON_HOLD_SUBTYPES,
  allowedTransitions,
  type ApplicationStage,
} from "../../../../../assets/shared/schemas/member-applications";
import { getMemberApplicationById, type MemberApplicationRow } from "./queries";
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
  application: {
    id: string;
    stage: string;
    stage_entered_at: string;
    transition_revision: number;
    on_hold_subtype: string | null;
    on_hold_reminder_sent_at: string | null;
    updated_at: string;
  };
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

export type ApplicationStageTransitionSubject = Pick<
  MemberApplicationRow,
  | "id"
  | "applicant_email"
  | "applicant_name"
  | "stage"
  | "stage_entered_at"
  | "transition_revision"
  | "on_hold_reminder_sent_at"
>;

/**
 * Builds the complete atomic write set for a previously loaded application.
 * Batch jobs use this to combine several transitions with one aggregate
 * notification without reimplementing the stage machine.
 */
export function prepareApplicationStageTransition(
  db: DatabaseLike,
  application: ApplicationStageTransitionSubject,
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
         SET stage = ?, stage_entered_at = ?, transition_revision = transition_revision + 1,
             on_hold_subtype = ?, updated_at = ?,
             on_hold_reminder_sent_at = NULL,
             consultation_notified_at = CASE
               WHEN ? = 'in_consultation' THEN NULL
               ELSE consultation_notified_at
             END
         WHERE id = ? AND stage = ? AND transition_revision = ?`,
      )
      .bind(
        params.toStage,
        now,
        nextOnHoldSubtype,
        now,
        params.toStage,
        application.id,
        fromStage,
        application.transition_revision,
      ),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?, ?, ?)`,
      )
      .bind(uuid(), application.id, fromStage, params.toStage, params.actorUserId, params.note ?? null, now),
  ];

  const outboxIds: string[] = [];
  if (params.toStage === "declined" || params.toStage === "withdrawn") {
    statements.push(prepareReleaseApplicationDomainClaim(db, application.id));
  }
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
        id: application.id,
        stage: params.toStage,
        stage_entered_at: now,
        transition_revision: application.transition_revision + 1,
        on_hold_subtype: nextOnHoldSubtype,
        on_hold_reminder_sent_at: null,
        updated_at: now,
      },
      fromStage,
      toStage: params.toStage,
      suggestedEmailTemplateKey,
      outboxIds,
    },
  };
}

export async function transitionLoadedApplicationStage(
  db: DatabaseLike,
  application: ApplicationStageTransitionSubject,
  params: StageTransitionParams,
): Promise<StageTransitionResult> {
  const prepared = prepareApplicationStageTransition(db, application, params);
  return executePreparedApplicationStageTransition(db, application, prepared);
}

/** Executes a previously built canonical transition without rebuilding it. */
export async function executePreparedApplicationStageTransition(
  db: DatabaseLike,
  application: ApplicationStageTransitionSubject,
  prepared: PreparedStageTransition,
): Promise<StageTransitionResult> {
  const fromStage = application.stage;
  let results: Awaited<ReturnType<DatabaseLike["batch"]>>;
  try {
    results = await db.batch(prepared.statements);
  } catch (error) {
    const current = await getMemberApplicationById(db, application.id);
    if (current && (current.stage !== fromStage || current.transition_revision !== application.transition_revision)) {
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

/**
 * Applies a stage transition: validates it against the state machine,
 * updates the canonical `stage`/`stage_entered_at`, writes a member_application_events
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

  return transitionLoadedApplicationStage(db, application, params);
}
