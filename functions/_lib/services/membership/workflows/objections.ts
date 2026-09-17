import type { z } from "zod";
import type {
  membershipWorkflowObjectionCreateSchema,
  membershipWorkflowObjectionResolveSchema,
} from "../../../../../assets/shared/schemas/membership-workflows";
import { hasPermission, preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { prepareAuditLog } from "../../audit";
import { getMembershipExecution } from "./execution";
import { commitMembershipWorkflow } from "./evaluate";
import { requireWorkflowReviewer, type MembershipReviewer } from "./reviewer-eligibility";

export async function recordMembershipObjection(
  db: DatabaseLike,
  applicationId: string,
  actor: MembershipReviewer,
  input: z.infer<typeof membershipWorkflowObjectionCreateSchema>,
  appBaseUrl: string,
) {
  const execution = await getMembershipExecution(db, applicationId);
  if (execution.revision !== input.expectedRevision)
    throw new AppError(409, "MEMBERSHIP_WORKFLOW_CHANGED", "The application changed. Reload before responding.");
  const position = execution.currentPosition;
  const step = execution.version.definition.steps[position];
  if (step?.kind !== "consensus" || execution.steps[position]?.state !== "active")
    throw new AppError(
      409,
      "MEMBERSHIP_CONSENSUS_NOT_ACTIVE",
      "There is no active consensus review for this application.",
    );
  const authorId = input.onBehalfOfUserId ?? actor.userId;
  const authorization = [];
  if (authorId !== actor.userId) {
    if (!actor.staff || !hasPermission(actor.staff, "membership:approve"))
      throw new AppError(
        403,
        "MEMBERSHIP_ATTRIBUTION_FORBIDDEN",
        "Recording another user's objection requires membership approval permission.",
      );
    authorization.push(preparePermissionsAuthorizationGuard(db, actor.staff, [{ permission: "membership:approve" }]));
  }
  authorization.push(await requireWorkflowReviewer(db, step, { userId: authorId }));
  const id = uuid();
  const now = nowIso();
  execution.objections.push({ position, unresolved: true });
  await commitMembershipWorkflow(
    db,
    execution,
    appBaseUrl,
    {
      actor: actor.staff ?? null,
      actorUserId: actor.userId,
      reason: input.reason,
      statements: [
        ...authorization,
        db
          .prepare(
            `INSERT INTO membership_application_objections
        (id, application_id, generation, step_position, author_user_id, recorded_by_user_id, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, applicationId, execution.generation, position, authorId, actor.userId, input.body, now),
        prepareAuditLog(
          db,
          "user",
          actor.userId,
          "membership_objection_recorded",
          "member_application",
          applicationId,
          { objectionId: id, authorUserId: authorId, reason: input.reason },
          now,
        ),
      ],
    },
    now,
  );
  return { objectionId: id };
}

export async function resolveMembershipObjection(
  db: DatabaseLike,
  applicationId: string,
  objectionId: string,
  actor: MembershipReviewer,
  input: z.infer<typeof membershipWorkflowObjectionResolveSchema>,
  appBaseUrl: string,
) {
  const execution = await getMembershipExecution(db, applicationId);
  if (execution.revision !== input.expectedRevision)
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_CHANGED",
      "The application changed. Reload before resolving this objection.",
    );
  const objection = await first<{ author_user_id: string | null; state: string }>(
    db,
    "SELECT author_user_id, state FROM membership_application_objections WHERE id = ? AND application_id = ?",
    [objectionId, applicationId],
  );
  if (!objection) throw new AppError(404, "MEMBERSHIP_OBJECTION_NOT_FOUND", "Objection not found");
  if (!["unresolved", "upheld"].includes(objection.state))
    throw new AppError(409, "MEMBERSHIP_OBJECTION_RESOLVED", "This objection already has a resolution.");
  const now = nowIso();
  const authorization = [];
  if (input.resolution === "withdrawn") {
    if (objection.author_user_id !== actor.userId)
      throw new AppError(
        403,
        "MEMBERSHIP_OBJECTION_WITHDRAWAL_FORBIDDEN",
        "Only the author may withdraw this objection.",
      );
    // Withdrawal remains possible after audience membership changes, but requires a live user identity.
    authorization.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM users WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
        bindings: [actor.userId],
      }),
    );
  } else {
    if (!actor.staff || !hasPermission(actor.staff, "membership:approve"))
      throw new AppError(
        403,
        "MEMBERSHIP_OBJECTION_RESOLUTION_FORBIDDEN",
        "Resolving or overruling an objection requires membership approval permission.",
      );
    authorization.push(preparePermissionsAuthorizationGuard(db, actor.staff, [{ permission: "membership:approve" }]));
  }
  // Recompute the proposed open set, retaining objections from superseded policy generations.
  const remaining = await first<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM membership_application_objections WHERE application_id = ? AND state IN ('unresolved', 'upheld') AND id <> ?",
    [applicationId, objectionId],
  );
  execution.objections = remaining?.count || input.resolution === "upheld" ? [{ position: 0, unresolved: true }] : [];
  return commitMembershipWorkflow(
    db,
    execution,
    appBaseUrl,
    {
      actor: actor.staff ?? null,
      actorUserId: actor.userId,
      reason: input.reason,
      statements: [
        ...authorization,
        db
          .prepare(
            `UPDATE membership_application_objections SET state = ?, resolution_reason = ?, resolved_by_user_id = ?, resolved_at = ?
        WHERE id = ? AND application_id = ? AND state = ?`,
          )
          .bind(input.resolution, input.reason, actor.userId, now, objectionId, applicationId, objection.state),
        prepareAuditLog(
          db,
          "user",
          actor.userId,
          "membership_objection_resolved",
          "member_application",
          applicationId,
          { objectionId, resolution: input.resolution, reason: input.reason },
          now,
        ),
      ],
    },
    now,
  );
}
