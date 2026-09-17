import type { z } from "zod";
import type {
  membershipWorkflowPublishSchema,
  MembershipWorkflowDefinition,
} from "../../../../../assets/shared/schemas/membership-workflows";
import { adminDatabaseUserId } from "../../../auth/admin-identity";
import { preparePermissionsAuthorizationGuard, requirePermission } from "../../../auth/permissions";
import { EXECUTIVE_COUNCIL_GROUP_SLUG } from "../../../auth/executive-council";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { prepareAuditLogAfterOneChange } from "../../audit";
import { getMembershipWorkflowVersion } from "./catalog";
import { workflowWriteConflict } from "./drafts";

/** Validate references once for useful errors, then retain live guards in the publish transaction. */
async function publicationReferenceGuards(
  db: DatabaseLike,
  definition: MembershipWorkflowDefinition,
): Promise<StatementLike[]> {
  const guards: StatementLike[] = [];
  for (const step of definition.steps) {
    const selectedGroupId =
      step.kind === "staff_review"
        ? step.reviewerGroupId
        : step.kind === "consensus" && step.audience.kind === "group"
          ? step.audience.groupId
          : null;
    if (selectedGroupId) {
      const query = { sql: "SELECT 1 FROM groups WHERE id = ? AND active = 1", bindings: [selectedGroupId] };
      if (!(await first(db, query.sql, query.bindings)))
        throw new AppError(422, "MEMBERSHIP_REVIEW_GROUP_UNAVAILABLE", `Choose an active group for ${step.label}`);
      guards.push(prepareAuthorizationGuard(db, query));
    }
    if (step.kind !== "consensus") continue;
    let audienceGroupId = selectedGroupId;
    if (step.audience.kind === "executive_council") {
      const council = await first<{ id: string }>(db, "SELECT id FROM groups WHERE slug = ? AND active = 1", [
        EXECUTIVE_COUNCIL_GROUP_SLUG,
      ]);
      if (!council)
        throw new AppError(
          422,
          "MEMBERSHIP_COUNCIL_UNAVAILABLE",
          "The Executive Council group must be active before publishing",
        );
      audienceGroupId = council.id;
      guards.push(
        prepareAuthorizationGuard(db, {
          sql: "SELECT 1 FROM groups WHERE id = ? AND active = 1",
          bindings: [council.id],
        }),
      );
    }
    if (step.destination.kind === "mailing_list") {
      const query = {
        sql: "SELECT 1 FROM mailing_lists WHERE id = ? AND active = 1 AND archived_at IS NULL AND (? IS NULL OR group_id = ?)",
        bindings: [step.destination.mailingListId, audienceGroupId, audienceGroupId],
      };
      if (!(await first(db, query.sql, query.bindings)))
        throw new AppError(
          422,
          "MEMBERSHIP_NOTICE_LIST_UNAVAILABLE",
          `Choose an active mailing list for the review audience in ${step.label}`,
        );
      guards.push(prepareAuthorizationGuard(db, query));
    }
  }
  return guards;
}

export async function publishMembershipWorkflow(
  db: DatabaseLike,
  actor: AuthAdmin,
  id: string,
  input: z.infer<typeof membershipWorkflowPublishSchema>,
  paymentConfigured: boolean,
) {
  requirePermission(actor, "membership:approve");
  const current = await getMembershipWorkflowVersion(db, id);
  if (current.status !== "draft")
    throw new AppError(409, "MEMBERSHIP_WORKFLOW_IMMUTABLE", "This workflow version is already published");
  if (!paymentConfigured && current.definition.steps.some((step) => step.kind === "payment")) {
    throw new AppError(
      422,
      "MEMBERSHIP_PAYMENT_UNAVAILABLE",
      "Configure membership payment processing before publishing a workflow that requires a fee",
    );
  }
  if (current.revision !== input.expectedRevision)
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_CHANGED",
      "The draft changed. Reload its publication summary before publishing.",
    );
  const guards = await publicationReferenceGuards(db, current.definition);
  const now = nowIso();
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "membership:write" },
        { permission: "membership:approve" },
      ]),
      ...guards,
      db
        .prepare(
          `UPDATE membership_workflow_versions SET status = 'published', published_at = ?, published_by_user_id = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND published_at IS NULL`,
        )
        .bind(now, adminDatabaseUserId(actor), id, current.revision),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "membership_workflow_published",
        "membership_workflow",
        id,
        { reason: input.reason, definition: current.definition },
        now,
      ),
    ]);
  } catch (error) {
    workflowWriteConflict(error);
  }
  return getMembershipWorkflowVersion(db, id);
}
