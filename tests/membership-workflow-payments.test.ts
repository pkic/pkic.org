import { membershipWorkflowProgress } from "../functions/_lib/services/membership/workflows/progress";
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createApplicationFormSubmission, seedMemberApplication } from "./helpers/member-applications";
import { getMembershipExecution } from "../functions/_lib/services/membership/workflows/execution";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";
import { prepareMembershipWorkflowPin } from "../functions/_lib/services/membership/workflows/pinning";
import { processMembershipFeeCheckouts } from "../functions/_lib/services/membership/workflows/fee-checkout";
import { requireMembershipCategory } from "../functions/_lib/services/membership/categories";
import { getMembershipWorkflowVersion } from "../functions/_lib/services/membership/workflows/catalog";
import { hmacSha256Hex } from "../functions/_lib/utils/crypto";
import { membershipWorkflowDefinitionSchema } from "../assets/shared/schemas/membership-workflows";
import type { Env } from "../functions/_lib/types";

const paymentEnv: Env = {
  ...env,
  STRIPE_SECRET_KEY: "sk_test_synthetic",
  MEMBERSHIP_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_membership",
};
beforeEach(resetDb);

async function prepareFeeApplication(options: { reviewAfterPayment?: boolean; failCheckout?: boolean } = {}) {
  const workflowId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const definition = membershipWorkflowDefinitionSchema.parse({
    name: "Paid organization",
    policyReference: "Synthetic future fee policy",
    steps: [
      {
        id: crypto.randomUUID(),
        kind: "payment",
        label: "Pay the membership fee",
        instructions: "Pay the required fee for Example Organization.",
        feeReference: "organization-admission",
        amount: 10000,
        currency: "usd",
        deadlineDays: 30,
      },
    ],
  });
  if (options.reviewAfterPayment)
    definition.steps.push({
      id: crypto.randomUUID(),
      kind: "staff_review",
      label: "Verify organization after payment",
      instructions: "Check the user's authority",
      reviewerGroupId: null,
    });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO membership_workflows (id, created_at) VALUES (?, ?)").bind(workflowId, now),
    env.DB.prepare(
      `INSERT INTO membership_workflow_versions (id, workflow_id, version, name, status, definition_json, created_at, published_at)
      VALUES (?, ?, 1, ?, 'published', ?, ?, ?)`,
    ).bind(versionId, workflowId, definition.name, JSON.stringify(definition), now, now),
    env.DB.prepare("UPDATE membership_categories SET workflow_version_id = ? WHERE code = 'F'").bind(versionId),
  ]);
  const formSubmissionId = await createApplicationFormSubmission({});
  const id = await seedMemberApplication({
    applicantName: "Example User",
    applicantEmail: "applicant@example.test",
    organizationName: "Example Organization",
    organizationDomain: "example.test",
    membershipCategory: "F",
    formSubmissionId,
    stage: "processing",
  });
  await env.DB.batch(
    prepareMembershipWorkflowPin(
      env.DB,
      id,
      await requireMembershipCategory(env.DB, "F"),
      await getMembershipWorkflowVersion(env.DB, versionId),
      1,
      now,
    ),
  );
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  let checkoutBody = new URLSearchParams();
  let requestKey = "";
  const fetcher: typeof fetch = async (_input, init) => {
    checkoutBody = new URLSearchParams(String(init?.body));
    requestKey = new Headers(init?.headers).get("Idempotency-Key") ?? "";
    if (options.failCheckout) throw new Error("Synthetic provider outage");
    return Response.json({ id: "cs_test_membership", url: "https://checkout.stripe.com/c/pay/cs_test_membership" });
  };
  expect(await processMembershipFeeCheckouts(env.DB, paymentEnv, "https://app.test", 1, fetcher)).toEqual({
    processed: options.failCheckout ? 0 : 1,
  });
  const metadata = Object.fromEntries(
    [...checkoutBody].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]),
  );
  return {
    id,
    checkoutBody: checkoutBody.toString(),
    requestKey,
    metadata,
    session: {
      id: "cs_test_membership",
      object: "checkout.session",
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_test_membership",
      amount_total: 10000,
      currency: "usd",
      customer_email: "applicant@example.test",
      metadata,
    },
  };
}
async function callback(
  object: unknown,
  type = "checkout.session.completed",
  eventId = `evt_${crypto.randomUUID()}`,
  validSignature = true,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: eventId, type, created: timestamp, data: { object } });
  const signature = await hmacSha256Hex(paymentEnv.MEMBERSHIP_STRIPE_WEBHOOK_SECRET!, `${timestamp}.${body}`);
  return app.fetch(
    new Request("https://app.test/api/v1/membership/payments/stripe/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${validSignature ? signature : "bad"}`,
      },
      body,
    }),
    paymentEnv,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
}

it("approves a payment-only organization only on exact verified payment, idempotently, without an EC stage", async () => {
  const { id, session } = await prepareFeeApplication();
  expect((await callback(session, undefined, undefined, false)).status).toBe(400);
  expect((await callback({ ...session, amount_total: 9999 })).status).toBe(200);
  expect((await callback({ ...session, currency: "eur" })).status).toBe(200);
  expect(
    (await callback({ ...session, metadata: { ...session.metadata, workflowVersionId: crypto.randomUUID() } })).status,
  ).toBe(200);
  expect((await callback({ ...session, metadata: { ...session.metadata, generation: "2" } })).status).toBe(200);

  expect((await callback({ ...session, payment_status: "unpaid" })).status).toBe(200);
  expect((await getMembershipExecution(env.DB, id)).application.stage).toBe("processing");
  const response = await callback(session, "checkout.session.async_payment_succeeded", "evt_membership_paid");
  expect(response.status, await response.clone().text()).toBe(200);
  expect((await getMembershipExecution(env.DB, id)).application.stage).toBe("approved");
  expect(
    await (await callback(session, "checkout.session.async_payment_succeeded", "evt_membership_paid")).json(),
  ).toMatchObject({ duplicate: true });
  const events = await env.DB.prepare("SELECT to_stage FROM member_application_events WHERE application_id = ?")
    .bind(id)
    .all<{ to_stage: string }>();
  expect(events.results.map((row) => row.to_stage)).toEqual(["approved"]);
  const adjustment = await callback({ payment_intent: "pi_test_membership" }, "charge.refunded");
  expect(adjustment.status).toBe(200);
  expect((await getMembershipExecution(env.DB, id)).steps[0].fee_handling_required).toBe(1);
  expect((await getMembershipExecution(env.DB, id)).application.stage).toBe("approved");
});

it("records late payment for a withdrawn application for staff handling without reopening it", async () => {
  const { id, session } = await prepareFeeApplication();
  await env.DB.prepare(
    "UPDATE member_applications SET stage = 'withdrawn', transition_revision = transition_revision + 1 WHERE id = ?",
  )
    .bind(id)
    .run();
  expect(membershipWorkflowProgress(await getMembershipExecution(env.DB, id)).steps[0].payment?.checkoutUrl).toBeNull();
  const response = await callback(session);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ outcome: "paid_requires_handling" });
  const execution = await getMembershipExecution(env.DB, id);
  expect(execution.application.stage).toBe("withdrawn");
  expect(execution.steps[0]).toMatchObject({ fee_status: "paid", fee_handling_required: 1 });
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first("count")).toBe(0);
});

it("retries an uncertain checkout with identical parameters and renews only after expiry", async () => {
  const fixture = await prepareFeeApplication({ failCheckout: true });
  await env.DB.prepare("UPDATE membership_fee_checkout_outbox SET next_attempt_at = ?")
    .bind(new Date().toISOString())
    .run();
  const calls: Array<{ body: string; key: string }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    calls.push({ body: String(init?.body), key: new Headers(init?.headers).get("Idempotency-Key") ?? "" });
    return Response.json({
      id: `cs_renewal_${calls.length}`,
      url: `https://checkout.stripe.com/c/pay/renewal_${calls.length}`,
    });
  };
  expect(await processMembershipFeeCheckouts(env.DB, paymentEnv, "https://app.test", 1, fetcher)).toEqual({
    processed: 1,
  });
  expect(calls[0]).toEqual({ body: fixture.checkoutBody, key: fixture.requestKey });
  expect(await processMembershipFeeCheckouts(env.DB, paymentEnv, "https://app.test", 1, fetcher)).toEqual({
    processed: 0,
  });
  const expired = new Date(Date.now() - 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE membership_fee_checkouts SET expires_at = ?").bind(expired),
    env.DB.prepare("UPDATE membership_fee_checkout_outbox SET next_attempt_at = ?").bind(expired),
  ]);
  expect(await processMembershipFeeCheckouts(env.DB, paymentEnv, "https://app.test", 1, fetcher)).toEqual({
    processed: 1,
  });
  expect(calls[1].key).not.toBe(calls[0].key);
  expect(new URLSearchParams(calls[1].body).get("metadata[membershipFeeId]")).toBe(fixture.metadata.membershipFeeId);
});

it("a refund before the final review blocks provisioning even though the payment step previously completed", async () => {
  const { id, session } = await prepareFeeApplication({ reviewAfterPayment: true });
  expect((await callback(session)).status).toBe(200);
  const paid = await getMembershipExecution(env.DB, id);
  expect(paid.currentPosition).toBe(1);
  expect(paid.steps[0].completed_at).not.toBeNull();
  expect((await callback({ payment_intent: session.payment_intent }, "charge.refunded")).status).toBe(200);
  await env.DB.prepare(
    "UPDATE membership_application_steps SET completed_at = ?, completion_reason = 'Verified form' WHERE application_id = ? AND position = 1",
  )
    .bind(new Date().toISOString(), id)
    .run();
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  expect((await getMembershipExecution(env.DB, id)).application.stage).toBe("processing");
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first("count")).toBe(0);
});

it("a payment received after the policy deadline requires handling and cannot provision membership", async () => {
  const { id, session } = await prepareFeeApplication();
  await env.DB.prepare("UPDATE membership_fee_intents SET deadline_at = ? WHERE application_id = ?")
    .bind(new Date(Date.now() - 60_000).toISOString(), id)
    .run();
  const response = await callback(session);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ outcome: "paid_requires_handling" });
  expect((await getMembershipExecution(env.DB, id)).application.stage).toBe("processing");
});
