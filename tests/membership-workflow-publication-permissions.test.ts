import { expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { seedPersona } from "./personas/seed";
import { membershipWorkflowVersionResponseSchema } from "../assets/shared/schemas/membership-workflows";

it("lets an application writer draft policy but requires approval authority to publish it", async () => {
  await resetDb();
  const writer = await seedPersona(env.DB, "membershipWriter");
  const approver = await seedPersona(env.DB, "membershipApprover");
  const base = "/api/v1/membership/workflows/versions";
  function post(path: string, token: string, body: unknown) {
    return callApi(env, path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const created = await post(base, writer.token!, {
    definition: {
      name: "Example Organization policy",
      policyReference: "Proposed organization admission policy",
      steps: [
        {
          id: crypto.randomUUID(),
          kind: "staff_review",
          label: "Review the submitted form",
          instructions: "Check the user's authority.",
          reviewerGroupId: null,
        },
      ],
    },
  });
  expect(created.status).toBe(200);
  const { workflow } = membershipWorkflowVersionResponseSchema.parse(await created.json());
  const body = { expectedRevision: workflow.revision, reason: "Adopt the organization review policy." };
  expect((await post(`${base}/${workflow.id}/publication`, writer.token!, body)).status).toBe(403);
  expect(
    await env.DB.prepare("SELECT status FROM membership_workflow_versions WHERE id = ?")
      .bind(workflow.id)
      .first("status"),
  ).toBe("draft");
  expect((await post(`${base}/${workflow.id}/publication`, approver.token!, body)).status).toBe(200);
});
