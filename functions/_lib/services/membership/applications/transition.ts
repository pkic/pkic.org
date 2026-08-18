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
import { ON_HOLD_SUBTYPES, allowedTransitions } from "../../../../../assets/shared/schemas/member-applications";
import { getMemberApplicationById, type MemberApplicationRow } from "./queries";
import type { ApplicationStage } from "./create";
import type { DatabaseLike } from "../../../types";

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
  /** Email template the caller should queue for the applicant, if any (route layer owns queueEmail — see functions/api/v1/members/applications/index.ts for the convention). */
  suggestedEmailTemplateKey: string | null;
}

/**
 * Applies a stage transition: validates it against the state machine,
 * updates `status`/`stage`/`stage_entered_at` (kept in sync, matching
 * createMemberApplication's convention), writes a member_application_events
 * row, and returns the applicant-facing email template the caller should
 * queue (if any) — this function does not call queueEmail itself, since it
 * has no access to `env`/`executionCtx` (same DB-only/route-owns-email split
 * createMemberApplication's call site already uses).
 */
export async function transitionApplicationStage(
  db: DatabaseLike,
  params: {
    applicationId: string;
    toStage: string;
    actorUserId: string | null;
    onHoldSubtype?: string | null;
    note?: string | null;
  },
): Promise<StageTransitionResult> {
  const application = await getMemberApplicationById(db, params.applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
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

  const [updateResult] = await db.batch([
    // Compare-and-set: only applies if the row is still in the stage we read.
    // Two concurrent transitions reading the same fromStage can no longer
    // both win — the loser's UPDATE affects 0 rows.
    db
      .prepare(
        `UPDATE member_applications
         SET status = ?, stage = ?, stage_entered_at = ?, on_hold_subtype = ?, updated_at = ?
         WHERE id = ? AND stage = ?`,
      )
      .bind(params.toStage, params.toStage, now, nextOnHoldSubtype, now, application.id, fromStage),
    // Conditioned on the UPDATE above having itself changed a row (SQLite's
    // changes() reflects the immediately preceding statement within the same
    // batch/transaction) — not merely on the row's current state, which a
    // concurrent winner transitioning to the same toStage could satisfy even
    // for the loser. A lost compare-and-set must not leave a history event
    // for a transition that never happened.
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(uuid(), application.id, fromStage, params.toStage, params.actorUserId, params.note ?? null, now),
  ]);

  if ((updateResult.meta?.changes ?? 0) === 0) {
    throw new AppError(
      409,
      "STAGE_TRANSITION_CONFLICT",
      `Application stage changed concurrently; expected '${fromStage}'`,
    );
  }

  const suggestedEmailTemplateKey =
    params.toStage === "on_hold"
      ? ON_HOLD_SUBTYPE_EMAIL_TEMPLATES[params.onHoldSubtype as OnHoldSubtype]
      : (STAGE_EMAIL_TEMPLATES[params.toStage] ?? null);

  return {
    application: {
      ...application,
      status: params.toStage,
      stage: params.toStage,
      stage_entered_at: now,
      on_hold_subtype: nextOnHoldSubtype,
      updated_at: now,
    },
    fromStage: application.stage,
    toStage: params.toStage,
    suggestedEmailTemplateKey,
  };
}
