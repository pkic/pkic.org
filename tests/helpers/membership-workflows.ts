import type { DatabaseLike } from "../../functions/_lib/types";
import { getMembershipWorkflowVersion } from "../../functions/_lib/services/membership/workflows/catalog";
import { requireMembershipCategory } from "../../functions/_lib/services/membership/categories";
import { prepareMembershipWorkflowPin } from "../../functions/_lib/services/membership/workflows/pinning";

/** Purpose-created completed review evidence for provisioning and concurrency tests. */
export async function pinReviewedStaffWorkflow(db: DatabaseLike, id: string, categoryCode = "F", completed = true) {
  const workflowId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const stepId = crypto.randomUUID();
  const now = new Date().toISOString();
  const definition = {
    name: "Onboarding fixture",
    policyReference: "Synthetic completed staff review",
    steps: [
      {
        id: stepId,
        kind: "staff_review",
        label: "Review organization and user",
        instructions: "Review the form",
        reviewerGroupId: null,
      },
    ],
  };
  await db.batch([
    db.prepare("INSERT INTO membership_workflows (id, created_at) VALUES (?, ?)").bind(workflowId, now),
    db
      .prepare(
        `INSERT INTO membership_workflow_versions
      (id, workflow_id, version, name, status, definition_json, created_at, published_at)
      VALUES (?, ?, 1, ?, 'published', ?, ?, ?)`,
      )
      .bind(versionId, workflowId, definition.name, JSON.stringify(definition), now, now),
  ]);
  const category = await requireMembershipCategory(db, categoryCode);
  await db.batch(
    prepareMembershipWorkflowPin(db, id, category, await getMembershipWorkflowVersion(db, versionId), 1, now, true),
  );
  if (completed)
    await db
      .prepare(
        `UPDATE membership_application_steps SET state = 'complete', completed_at = ?,
    completion_reason = 'Verified organization, user, and submitted form' WHERE application_id = ?`,
      )
      .bind(now, id)
      .run();
}
