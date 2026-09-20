import { pinReviewedStaffWorkflow } from "./helpers/membership-workflows";
import { membershipWorkflowMigrationPreviewResponseSchema } from "../assets/shared/schemas/membership-workflow-migration";
import { seedMemberApplication } from "./helpers/member-applications";
import { getMembershipExecution } from "../functions/_lib/services/membership/workflows/execution";
import { expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import {
  membershipWorkflowVersionResponseSchema,
  membershipWorkflowsResponseSchema,
} from "../assets/shared/schemas/membership-workflows";

it("publishes immutable reusable workflow versions and assigns only published policy to a category", async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const token = await createAdminSession(env.DB, admin.id, "membership-workflows-admin");
  const base = "/api/v1/membership/workflows/versions";
  async function call(path: string, method = "GET", body?: unknown, requestEnv: typeof env = env) {
    return app.fetch(
      new Request(`https://app.test${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      requestEnv as any,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
  }
  const catalog = membershipWorkflowsResponseSchema.parse(await (await call(base)).json());
  expect(catalog.page.total).toBe(1);
  const standard = catalog.workflows[0];
  expect(standard.status).toBe("published");
  const createdResponse = await call(base, "POST", {
    sourceVersionId: standard.id,
    definition: { ...standard.definition, name: "Organization review", steps: [standard.definition.steps[0]] },
  });
  expect(createdResponse.status).toBe(200);
  const draft = membershipWorkflowVersionResponseSchema.parse(await createdResponse.json()).workflow;
  expect(draft).toMatchObject({ workflowId: standard.workflowId, version: 2, status: "draft" });
  const premature = await call("/api/v1/membership/categories/A", "PATCH", {
    workflowVersionId: draft.id,
    expectedRevision: 0,
  });
  expect(premature.status).toBe(409);
  const publishedResponse = await call(`${base}/${draft.id}/publication`, "POST", {
    expectedRevision: 0,
    reason: "Adopt staff review for this synthetic organization category.",
  });
  expect(publishedResponse.status).toBe(200);
  const published = membershipWorkflowVersionResponseSchema.parse(await publishedResponse.json()).workflow;
  expect(published.status).toBe("published");
  expect(published.publishedAt).toMatch(/\.\d{3}Z$/);
  expect(
    (
      await call(`${base}/${draft.id}`, "PATCH", {
        expectedRevision: published.revision,
        definition: standard.definition,
      })
    ).status,
  ).toBe(409);
  await expect(
    env.DB.prepare("UPDATE membership_workflow_versions SET definition_json = '{}' WHERE id = ?").bind(draft.id).run(),
  ).rejects.toThrow("PUBLISHED_MEMBERSHIP_WORKFLOW_IMMUTABLE");
  const assigned = await call("/api/v1/membership/categories/A", "PATCH", {
    workflowVersionId: draft.id,
    expectedRevision: 0,
  });
  expect(assigned.status).toBe(200);
  expect(await assigned.json()).toMatchObject({ category: { workflowVersionId: draft.id, active: true } });
  const renamed = await call("/api/v1/membership/categories/A", "PATCH", {
    label: "Example organization",
    expectedRevision: 1,
  });
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toMatchObject({ category: { workflowVersionId: draft.id, active: true } });
  const searched = membershipWorkflowsResponseSchema.parse(
    await (await call(`${base}?q=Organization&status=published&limit=1&sort=-version`)).json(),
  );
  expect(searched.workflows.map((version) => version.id)).toEqual([draft.id]);
  expect(searched.page).toMatchObject({ total: 1, limit: 1, hasMore: false });

  const paidResponse = await call(base, "POST", {
    definition: {
      name: "Future paid organization membership",
      policyReference: "Proposed fee policy; not adopted",
      steps: [
        {
          id: crypto.randomUUID(),
          kind: "payment",
          label: "Membership fee",
          instructions: "Pay the membership fee for Example Organization.",
          feeReference: "organization-fee",
          amount: 10000,
          currency: "usd",
          deadlineDays: 30,
        },
      ],
    },
  });
  expect(paidResponse.status).toBe(200);
  const paid = membershipWorkflowVersionResponseSchema.parse(await paidResponse.json()).workflow;
  expect(
    (
      await call(
        `${base}/${paid.id}/publication`,
        "POST",
        {
          expectedRevision: 0,
          reason: "Payment configuration is incomplete.",
        },
        { ...env, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined },
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await call(
        `${base}/${paid.id}/publication`,
        "POST",
        {
          expectedRevision: 0,
          reason: "Stripe checkout is configured; local testing uses manual reconciliation.",
        },
        { ...env, STRIPE_SECRET_KEY: "sk_test_local", STRIPE_WEBHOOK_SECRET: undefined },
      )
    ).status,
  ).toBe(200);
});

it("restores seeded workflow policy between scenarios without removing production immutability", async () => {
  await resetDb();
  const versions = await queryAll<{ id: string; status: string }>(
    env.DB,
    "SELECT id, status FROM membership_workflow_versions",
  );
  expect(versions).toHaveLength(1);
  expect(versions[0].status).toBe("published");
  const categories = await queryAll<{ workflow_version_id: string }>(
    env.DB,
    "SELECT workflow_version_id FROM membership_categories",
  );
  expect(categories.every((category) => category.workflow_version_id === versions[0].id)).toBe(true);
  await expect(
    env.DB.prepare("DELETE FROM membership_workflow_versions WHERE id = ?").bind(versions[0].id).run(),
  ).rejects.toThrow("PUBLISHED_MEMBERSHIP_WORKFLOW_IMMUTABLE");
});

it("previews policy changes, rejects stale previews, and preserves blocking objections", async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const token = await createAdminSession(env.DB, admin.id, "workflow-migration-admin");
  const applicationId = await seedMemberApplication({
    applicantEmail: "applicant@example.test",
    organizationDomain: "example.test",
    organizationName: "Example Organization",
    stage: "processing",
  });
  const [version] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM membership_workflow_versions WHERE status = 'published'",
  );
  await pinReviewedStaffWorkflow(env.DB, applicationId);
  async function call(method: string, body?: unknown) {
    const suffix = method === "GET" ? `?versionId=${version.id}` : "";
    return app.fetch(
      new Request(`https://app.test/api/v1/members/applications/${applicationId}/workflow/migration${suffix}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env as any,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
  }
  const preview = membershipWorkflowMigrationPreviewResponseSchema.parse(await (await call("GET")).json());
  expect(preview).toMatchObject({ fromVersionId: expect.any(String), generation: 2, unresolvedObjections: 0 });
  await env.DB.prepare(
    "INSERT INTO membership_application_objections (id, application_id, generation, step_position, author_user_id, body, created_at) VALUES (?, ?, 1, 0, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      applicationId,
      admin.id,
      "The organization authority must be checked.",
      new Date().toISOString(),
    )
    .run();
  expect(
    (
      await call("POST", {
        versionId: version.id,
        previewFingerprint: preview.fingerprint,
        reason: "Move the application to the adopted policy.",
        acknowledgeRestart: true,
      })
    ).status,
  ).toBe(409);
  const fresh = membershipWorkflowMigrationPreviewResponseSchema.parse(await (await call("GET")).json());
  expect(fresh.unresolvedObjections).toBe(1);
  const applied = await call("POST", {
    versionId: version.id,
    previewFingerprint: fresh.fingerprint,
    reason: "Restart with full notice windows and preserve the objection.",
    acknowledgeRestart: true,
  });
  expect(applied.status, await applied.clone().text()).toBe(200);
  const execution = await getMembershipExecution(env.DB, applicationId);
  expect(execution.application.stage).toBe("processing");
  expect(execution.steps.every((step) => step.state === "waiting" && step.completed_at === null)).toBe(true);
  expect(execution.objections).toHaveLength(1);
  const restart = membershipWorkflowMigrationPreviewResponseSchema.parse(await (await call("GET")).json());
  expect(restart.fromVersionId).toBe(version.id);
  const restarted = await call("POST", {
    versionId: version.id,
    previewFingerprint: restart.fingerprint,
    reason: "Restart this same policy after correcting the submitted form.",
    acknowledgeRestart: true,
  });
  expect(restarted.status, await restarted.clone().text()).toBe(200);
  expect((await getMembershipExecution(env.DB, applicationId)).generation).toBe(3);
});
