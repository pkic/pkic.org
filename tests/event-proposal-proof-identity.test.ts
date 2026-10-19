import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofIdentityPatchSchema,
  eventProposalProofVerifyResponseSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { JOB_TITLE_REQUIRED } from "../assets/shared/schemas/api-common";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { updateEventProposalOwnIdentity } from "../functions/_lib/services/event-proposal-proof-identity";
import { nowIso } from "../functions/_lib/utils/time";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { seedOrganizationAggregate, insertOrganization, insertUser } from "./helpers/membership";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const patch = (identityId: string, body: unknown, session?: string) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals/proof/identities/${identityId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
async function identityFor(userId: string, name: string, jobTitle = "Original role") {
  const organizationId = await insertOrganization(env.DB, name);
  const created = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    source: "staff",
    startImmediately: true,
    jobTitle,
  });
  await env.DB.batch([created.statement]);
  return { identityId: created.identityId, organizationId };
}
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, "person@official.example");
  await env.DB.prepare(
    "UPDATE users SET first_name='Canonical',last_name='Person',email_verified_at='2026-10-05T00:00:00.000Z',email_verification_method='staff_verified' WHERE id=?",
  )
    .bind(userId)
    .run();
  const own = await identityFor(userId, "Canonical nonmember organization");
  // Staff-owned canonical claim, not a claim made by a mailbox-holder's profile edit.
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      "official.example",
      own.organizationId,
      "2026-10-05T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    )
    .run();
  const proof = await prepareProposalProof({
    environment: env,
    eventSlug: "pqc-2026",
    email: "person@official.example",
    consents,
    unaffiliatedAttestation: false,
  });
  return { eventId, userId, ...own, proof };
}
async function state() {
  return {
    users: await queryAll(env.DB, "SELECT id,first_name,last_name,email_verified_at FROM users ORDER BY id"),
    identities: await queryAll(
      env.DB,
      "SELECT id,user_id,organization_id,email_id,job_title,source,started_at,ended_at,blocked_at,updated_at FROM identities ORDER BY id",
    ),
    organizations: await queryAll(env.DB, "SELECT id,name FROM organizations ORDER BY id"),
    selections: await queryAll(
      env.DB,
      "SELECT id,acting_identity_id,acting_identity_selected_at FROM proposal_speakers ORDER BY id",
    ),
    publications: await queryAll(env.DB, "SELECT id,snapshot_json FROM event_agenda_publications ORDER BY id"),
    audit: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
    publicationRequests: await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY sequence"),
    outbox: await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id"),
  };
}
async function existingProposal(input: Awaited<ReturnType<typeof fixture>>) {
  const response = await callApi(env, "/api/v1/events/pqc-2026/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      proposalCreateSchema.parse({
        ...input.proof,
        proposer: { actingIdentityId: input.identityId },
        consents,
        proposal: {
          type: "Talk",
          title: "A frozen original representation",
          abstract:
            "A sufficiently detailed conference proposal showing canonical organization identity reuse, verified mailbox authority, independently editable role descriptions, and a frozen proposal representation that does not silently follow later profile updates.",
        },
      }),
    ),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await queryAll<{ id: string }>(env.DB, "SELECT id FROM proposal_speakers WHERE user_id=?", input.userId))[0]
    .id;
}
const submissionBody = (input: Awaited<ReturnType<typeof fixture>>, proposer: Record<string, unknown>) => ({
  ...input.proof,
  proposer,
  consents,
  proposal: {
    type: "Talk",
    title: "A proposal on behalf of an organization",
    abstract:
      "A sufficiently detailed conference proposal showing that a speaker taking part on behalf of an organization always says what they do there, whichever representation they speak as.",
  },
});
/** Starts a fresh mailbox confirmation through the API and reads its link from the delivered email. */
async function verificationTokenFor(email: string): Promise<string> {
  const started = await callApi(env, "/api/v1/events/pqc-2026/proposals/proof", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, consents, unaffiliatedAttestation: false }),
  });
  expect(started.status, await started.clone().text()).toBe(200);
  const row = await env.DB.prepare(
    "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=? ORDER BY rowid DESC LIMIT 1",
  )
    .bind(email)
    .first<{ payload_json: string }>();
  const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row!.payload_json);
  return new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get("verify")!;
}
const submit = (body: unknown) =>
  callApi(env, "/api/v1/events/pqc-2026/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("job title on behalf of an organization", () => {
  it("refuses a new affiliation without a job title on the proposer's field, before any write", async () => {
    const input = await fixture();
    const body = submissionBody(input, {});
    const contract = proposalCreateSchema.safeParse(body);
    expect(contract.error?.issues.map((issue) => issue.path.join("."))).toContain("proposer.jobTitle");
    const before = await state();
    const response = await submit(body);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(JOB_TITLE_REQUIRED);
    expect(await state()).toEqual(before);
  });

  it("returns the job title of a representation the confirmed person already holds, so it is not asked again", async () => {
    await fixture();
    const verified = await callApi(env, "/api/v1/events/pqc-2026/proposals/proof/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: await verificationTokenFor("person@official.example"),
      }),
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    const ready = eventProposalProofVerifyResponseSchema.parse(await verified.json());
    if (ready.status !== "ready") throw new Error("Expected a ready confirmation");
    expect(ready.organization).toMatchObject({ name: "Canonical nonmember organization", jobTitle: "Original role" });
  });

  it("refuses a chosen representation without a job title on the proposer's field, before any write", async () => {
    const input = await fixture();
    await env.DB.prepare("UPDATE identities SET job_title=NULL WHERE id=?").bind(input.identityId).run();
    const before = await state();
    const response = await submit(
      proposalCreateSchema.parse(submissionBody(input, { actingIdentityId: input.identityId })),
    );
    expect(response.status).toBe(422);
    const refusal = await response.json();
    expect(refusal).toMatchObject({
      error: {
        code: "REPRESENTATION_JOB_TITLE_REQUIRED",
        details: { fieldErrors: { "proposer.jobTitle": [JOB_TITLE_REQUIRED] } },
      },
    });
    expect(await state()).toEqual(before);
  });
});

describe("proposal own representation role update", () => {
  it("changes only the owned current role while preserving parallel identities and frozen proposal appearances", async () => {
    const input = await fixture();
    const parallel = await identityFor(input.userId, "Parallel organization", "Parallel role");
    await existingProposal(input);
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "person@official.example",
      consents,
      unaffiliatedAttestation: false,
    });
    const before = await state();
    const response = await patch(input.identityId, {
      jobTitle: "Updated own role",
      continuationToken: proof.continuationToken,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await response.json())).toMatchObject({
      identityId: input.identityId,
      jobTitle: "Updated own role",
    });
    const after = await state();
    expect(after.organizations).toEqual(before.organizations);
    expect(after.selections).toEqual(before.selections);
    expect(after.publications).toEqual(before.publications);
    expect(after.identities.find((row) => row.id === parallel.identityId)).toEqual(
      before.identities.find((row) => row.id === parallel.identityId),
    );
    expect(after.identities.find((row) => row.id === input.identityId)).toMatchObject({
      user_id: input.userId,
      organization_id: input.organizationId,
      email_id: null,
      source: "staff",
      job_title: "Updated own role",
    });
    expect(after.audit).toHaveLength(before.audit.length + 1);
    expect(after.outbox).toEqual(before.outbox);
    expect(await queryAll(env.DB, "SELECT id FROM members")).toHaveLength(0);
  });
  it("refuses clearing a representation's job title, which taking part on its behalf requires", async () => {
    const input = await fixture();
    const session = await createMemberSession(env.DB, input.userId, "nonmember-own-role", undefined, input.identityId);
    expect(eventProposalProofIdentityPatchSchema.safeParse({ jobTitle: null }).success).toBe(false);
    const before = await state();
    const response = await callApi(
      env,
      `/api/v1/events/pqc-2026/proposals/proof/identities/${encodeURIComponent(input.identityId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
        body: JSON.stringify({ jobTitle: "" }),
      },
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(JOB_TITLE_REQUIRED);
    expect((await state()).identities).toEqual(before.identities);
  });
  it("queues a changed visible member profile through speaker proof, but not an identical repeat", async () => {
    const input = await fixture();
    await seedOrganizationAggregate(env.DB, input.organizationId);
    const body = { biography: "Updated member biography", continuationToken: input.proof.continuationToken };
    const first = await patch(input.identityId, body);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual([
      { resource_id: input.identityId, reason_code: "identity_profile_changed" },
    ]);
    const repeated = await patch(input.identityId, body);
    expect(repeated.status, await repeated.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
  });

  it("accepts the current invited speaker's own capability without altering its selection", async () => {
    const input = await fixture();
    const speakerId = await existingProposal(input);
    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "speaker_manage",
      resourceId: speakerId,
      ttlSeconds: 3600,
    });
    const before = await state();
    const response = await patch(input.identityId, { jobTitle: "Invited own role", speakerManagementToken: token });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await state()).selections).toEqual(before.selections);
  });
  it("refuses foreign ownership and extra organization or mailbox fields without effects", async () => {
    const input = await fixture();
    const foreign = await identityFor(await insertUser(env.DB, "foreign@another.example"), "Foreign organization");
    const before = await state();
    expect(
      (await patch(foreign.identityId, { jobTitle: "Foreign", continuationToken: input.proof.continuationToken }))
        .status,
    ).toBe(404);
    for (const extra of [
      { organizationId: input.organizationId },
      { emailId: null },
      { organizationName: "Renamed shared organization" },
    ])
      expect(
        (
          await patch(input.identityId, {
            jobTitle: "Rejected",
            continuationToken: input.proof.continuationToken,
            ...extra,
          })
        ).status,
      ).toBe(400);
    expect(await state()).toEqual(before);
  });
  it.each(["pending", "ended", "blocked"] as const)(
    "refuses %s representation editing with no audit",
    async (status) => {
      const input = await fixture();
      if (status === "pending")
        await env.DB.prepare("UPDATE identities SET started_at=NULL WHERE id=?").bind(input.identityId).run();
      if (status === "ended")
        await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), input.identityId).run();
      if (status === "blocked")
        await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?")
          .bind(nowIso(), nowIso(), input.identityId)
          .run();
      const before = await state();
      expect(
        (await patch(input.identityId, { jobTitle: "Rejected", continuationToken: input.proof.continuationToken }))
          .status,
      ).toBe(409);
      expect(await state()).toEqual(before);
    },
  );
  it("requires the representation's selected email to remain verified", async () => {
    const input = await fixture();
    const session = await createMemberSession(env.DB, input.userId, "unverified-own-role", undefined, input.identityId);
    await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(input.userId).run();
    const before = await state();
    expect((await patch(input.identityId, { jobTitle: "Rejected" }, session)).status).toBe(422);
    expect(await state()).toEqual(before);
  });
  it.each(["ended", "version", "mailbox", "session"] as const)(
    "rolls back title and audit when %s changes at the final batch",
    async (change) => {
      const input = await fixture();
      await createMemberSession(env.DB, input.userId, "race-own-role", undefined, input.identityId);
      const session = (
        await queryAll<{ id: string }>(env.DB, "SELECT id FROM sessions WHERE user_id=?", input.userId)
      )[0];
      let concurrent: Awaited<ReturnType<typeof state>>;
      const db = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "ended")
          await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), input.identityId).run();
        if (change === "version")
          await env.DB.prepare(
            "UPDATE identities SET job_title='Concurrent role',updated_at='2026-10-05T01:00:00.000Z' WHERE id=?",
          )
            .bind(input.identityId)
            .run();
        if (change === "mailbox")
          await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(input.userId).run();
        if (change === "session")
          await env.DB.prepare("UPDATE sessions SET revoked_at='2026-10-05T00:00:00.000Z' WHERE id=?")
            .bind(session.id)
            .run();
        concurrent = await state();
      });
      await expect(
        updateEventProposalOwnIdentity(db, {
          eventId: input.eventId,
          identityId: input.identityId,
          signingSecret: env.INTERNAL_SIGNING_SECRET!,
          actor: { userId: input.userId, sessionId: session.id },
          body: { jobTitle: "Rejected" },
        }),
      ).rejects.toMatchObject({ status: 409, code: "IDENTITY_CHANGED" });
      expect(await state()).toEqual(concurrent!);
    },
  );
  it("rechecks a revoked speaker capability in the actual role-write batch", async () => {
    const input = await fixture();
    const speakerId = await existingProposal(input);
    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "speaker_manage",
      resourceId: speakerId,
      ttlSeconds: 3600,
    });
    let concurrent: Awaited<ReturnType<typeof state>>;
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE proposal_speakers SET manage_link_secret=? WHERE id=?")
        .bind(crypto.randomUUID(), speakerId)
        .run();
      concurrent = await state();
    });
    await expect(
      updateEventProposalOwnIdentity(db, {
        eventId: input.eventId,
        identityId: input.identityId,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        body: { jobTitle: "Rejected", speakerManagementToken: token },
      }),
    ).rejects.toMatchObject({ status: 409, code: "IDENTITY_CHANGED" });
    expect(await state()).toEqual(concurrent!);
  });
});
