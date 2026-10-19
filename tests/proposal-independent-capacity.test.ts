import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { independentCapacityFixture } from "./helpers/independent-capacity";
import { INDEPENDENT_CAPACITY_COPY } from "../assets/shared/email-first-copy";
import { proposalSpeakersResponseSchema } from "../assets/shared/schemas/proposal-speakers";
import { independentCapacityDecisionResponseSchema } from "../assets/shared/schemas/independent-capacity";

const consents = [{ termKey: "speaker-terms", version: "v1" }];
const email = "independent.speaker@gmail.com";

async function submit(independentCapacity: unknown) {
  const { independentCapacity: _fixture, ...proof } = await prepareProposalProof({
    environment: env,
    eventSlug: "pqc-2026",
    email,
    consents,
    unaffiliatedAttestation: true,
  });
  return callApi(env, "/api/v1/events/pqc-2026/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...proof,
      ...(independentCapacity === undefined ? {} : { independentCapacity }),
      proposer: { firstName: "Indie", lastName: "Speaker", actingIdentityId: null },
      proposal: {
        type: "Talk",
        title: "An independent perspective on PKI",
        abstract:
          "A detailed conference proposal from an independent consultant about operating certificate lifecycles without an employer behind the talk, with lessons drawn from public sources.",
      },
      consents,
    }),
  });
}

describe("independent speaker disclosure", () => {
  let adminToken = "";
  let adminId = "";
  beforeEach(async () => {
    await resetDb();
    const seeded = await seedEventAndAdmin(env.DB);
    adminId = seeded.admin.id;
    await seedWorkflowEmailTemplates(env.DB, adminId);
    adminToken = await createAdminSession(env.DB, adminId, "independent-capacity-admin");
  });

  it("refuses the individual path without a disclosure or when the person represents an organization", async () => {
    const missing = await submit(undefined);
    expect(missing.status).toBe(400);
    const connected = await submit(independentCapacityFixture({ organizationConnection: "yes" }));
    expect(connected.status).toBe(400);
    expect(JSON.stringify(await connected.json())).toContain(INDEPENDENT_CAPACITY_COPY.connectedSteer);
    const incomplete = await submit({ ...independentCapacityFixture(), currentPosition: "" });
    expect(incomplete.status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM proposal_speaker_independent_disclosures")).toHaveLength(0);
  });

  it("stores a versioned, audited disclosure that reviewers verify or turn into a representation request", async () => {
    const response = await submit(independentCapacityFixture());
    expect(response.status, await response.clone().text()).toBe(200);
    const { proposalId } = (await response.json()) as { proposalId: string };
    const [stored] = await queryAll<Record<string, string>>(
      env.DB,
      "SELECT text_version,answers_json,email_domain_kind,review_status,superseded_at FROM proposal_speaker_independent_disclosures",
    );
    expect(stored).toMatchObject({
      text_version: independentCapacityFixture().version,
      email_domain_kind: "personal",
      review_status: "pending",
      superseded_at: null,
    });
    expect(JSON.parse(stored.answers_json)).toMatchObject({ currentPosition: "Independent consultant" });
    expect(
      await queryAll(env.DB, "SELECT scope_id FROM audit_log WHERE action='independent_capacity_disclosed'"),
    ).toEqual([{ scope_id: proposalId }]);

    const auth = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const roster = proposalSpeakersResponseSchema.parse(
      await (await callApi(env, `/api/v1/proposals/${proposalId}/speakers`, { headers: auth })).json(),
    );
    const speaker = roster.speakers[0];
    expect(speaker.independentCapacity).toMatchObject({ status: "pending", emailDomainKind: "personal" });
    const review = (decision: string) =>
      callApi(env, `/api/v1/proposals/${proposalId}/speakers/${speaker.userId}/disclosure/review`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ decision }),
      });

    const verified = await review("verified");
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(independentCapacityDecisionResponseSchema.parse(await verified.json()).review).toMatchObject({
      status: "verified",
      reviewedByName: null,
    });
    const requested = await review("representation_requested");
    expect(requested.status).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT recipient_email FROM email_outbox WHERE template_key='proposal_organizational_representation_request'",
      ),
    ).toContainEqual({ recipient_email: email });
    expect(
      (
        await queryAll<{ action: string }>(
          env.DB,
          "SELECT action FROM audit_log WHERE action LIKE 'independent_capacity_%' ORDER BY created_at,rowid",
        )
      ).map((row) => row.action),
    ).toEqual([
      "independent_capacity_disclosed",
      "independent_capacity_verified",
      "independent_capacity_representation_requested",
    ]);
  });
});
