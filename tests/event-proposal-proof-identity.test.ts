import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofIdentityPatchSchema,
  eventProposalProofStartSchema,
  eventProposalProofVerifyResponseSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { JOB_TITLE_REQUIRED } from "../assets/shared/schemas/api-common";
import { proposalCreateResponseSchema, proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { updateEventProposalOwnIdentity } from "../functions/_lib/services/event-proposal-proof-identity";
import { nowIso } from "../functions/_lib/utils/time";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { callApi } from "./helpers/app";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { seedOrganizationAggregate, insertOrganization, insertUser } from "./helpers/membership";
import { prepareProposalProof, signInProposer } from "./helpers/proposal-proof";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication } from "./helpers/member-applications";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const post = (suffix: string, body: unknown, headers: Record<string, string> = {}) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const patch = (identityId: string, body: unknown, headers: Record<string, string> = {}) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals/proof/identities/${encodeURIComponent(identityId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
/** A proposal on behalf of the organization of an identity the signed-in person holds. */
const proposalAs = (actingIdentityId: string) =>
  proposalCreateSchema.parse({
    proposer: { actingIdentityId },
    consents,
    proposal: {
      type: "Talk",
      title: "A proposal on behalf of an organization",
      abstract:
        "A sufficiently detailed conference proposal showing that a speaker taking part on behalf of an organization always says what they do there, whichever representation they speak as.",
    },
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
/** A signed-in person who represents an organization that holds their work domain. */
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const person = await signInProposer({
    environment: env,
    email: "person@official.example",
    firstName: "Canonical",
    lastName: "Person",
  });
  const own = await identityFor(person.userId, "Canonical nonmember organization");
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
  return { eventId, ...person, ...own };
}
/** The person's proposal as their representation, and the speaker link to their place on it. */
async function speakerLink(input: Awaited<ReturnType<typeof fixture>>) {
  const response = await post("", proposalAs(input.identityId), input.headers);
  expect(response.status, await response.clone().text()).toBe(200);
  const { proposalId } = proposalCreateResponseSchema.parse(await response.json());
  const speakerId = await env.DB.prepare("SELECT id FROM proposal_speakers WHERE proposal_id=? AND user_id=?")
    .bind(proposalId, input.userId)
    .first<string>("id");
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "speaker_manage",
    resourceId: speakerId!,
    ttlSeconds: 3600,
  });
  return { speakerId: speakerId!, token };
}
/** The speaker's own address confirmed on their speaker link: the authority a mailbox confirmation edits with. */
async function confirmedMailbox(input: Awaited<ReturnType<typeof fixture>>) {
  const link = await speakerLink(input);
  const proof = await prepareProposalProof({
    environment: env,
    eventSlug: "pqc-2026",
    email: "person@official.example",
    consents,
    unaffiliatedAttestation: false,
    speakerManagementToken: link.token,
  });
  return {
    continuationToken: proof.continuationToken,
    speakerManagementToken: proof.speakerManagementToken ?? link.token,
  };
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

describe("an organization representation chosen for a proposal", () => {
  it("reuses an approved owned representation while a domain application prevents new affiliations", async () => {
    await seedEventAndAdmin(env.DB);
    const person = await signInProposer({
      environment: env,
      email: "speaker@held-company.test",
      firstName: "Casey",
      lastName: "Example",
    });
    const { identityId } = await identityFor(person.userId, "Approved organization", "Researcher");
    await seedMemberApplication({
      applicantEmail: "applicant@held-company.test",
      organizationDomain: "held-company.test",
    });
    const saved = await post("", proposalAs(identityId), person.headers);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", person.userId)).toEqual([
      { id: identityId },
    ]);
    expect(await queryAll(env.DB, "SELECT acting_identity_id FROM proposal_speakers")).toEqual([
      { acting_identity_id: identityId },
    ]);
  });

  it("refuses a chosen representation without a job title on the proposer's field, before any write", async () => {
    const input = await fixture();
    await env.DB.prepare("UPDATE identities SET job_title=NULL WHERE id=?").bind(input.identityId).run();
    const before = await state();
    const response = await post("", proposalAs(input.identityId), input.headers);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: "REPRESENTATION_JOB_TITLE_REQUIRED",
        details: { fieldErrors: { "proposer.jobTitle": [JOB_TITLE_REQUIRED] } },
      },
    });
    expect(await state()).toEqual(before);
  });

  it("returns the job title of a representation the confirmed speaker already holds, so it is not asked again", async () => {
    const input = await fixture();
    const link = await speakerLink(input);
    const started = await post(
      "/proof",
      eventProposalProofStartSchema.parse({
        email: "person@official.example",
        consents,
        speakerManagementToken: link.token,
      }),
    );
    expect(started.status, await started.clone().text()).toBe(200);
    const row = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email='person@official.example'",
    ).first<{ payload_json: string }>();
    const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row!.payload_json);
    const verified = await post("/proof/verify", {
      token: new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get("verify"),
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    const ready = eventProposalProofVerifyResponseSchema.parse(await verified.json());
    if (ready.status !== "ready") throw new Error("Expected a ready confirmation");
    expect(ready.organization).toMatchObject({ name: "Canonical nonmember organization", jobTitle: "Original role" });
  });
});

describe("proposal own representation role update", () => {
  it("changes only the owned current role while preserving parallel identities and frozen proposal appearances", async () => {
    const input = await fixture();
    const parallel = await identityFor(input.userId, "Parallel organization", "Parallel role");
    const authority = await confirmedMailbox(input);
    const before = await state();
    const response = await patch(
      input.identityId,
      eventProposalProofIdentityPatchSchema.parse({ jobTitle: "Updated own role", ...authority }),
    );
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
    expect(eventProposalProofIdentityPatchSchema.safeParse({ jobTitle: null }).success).toBe(false);
    const before = await state();
    const response = await patch(input.identityId, { jobTitle: "" }, input.headers);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(JOB_TITLE_REQUIRED);
    expect((await state()).identities).toEqual(before.identities);
  });
  it("queues a changed visible member profile through speaker proof, but not an identical repeat", async () => {
    const input = await fixture();
    await seedOrganizationAggregate(env.DB, input.organizationId);
    const body = eventProposalProofIdentityPatchSchema.parse({
      biography: "Updated member biography",
      ...(await confirmedMailbox(input)),
    });
    const first = await patch(input.identityId, body);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual([
      { resource_id: input.identityId, reason_code: "identity_profile_changed" },
    ]);
    const repeated = await patch(input.identityId, body);
    expect(repeated.status, await repeated.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
  });

  it("accepts the current speaker's own capability without altering its selection", async () => {
    const input = await fixture();
    const { token } = await speakerLink(input);
    const before = await state();
    const response = await patch(input.identityId, { jobTitle: "Invited own role", speakerManagementToken: token });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await state()).selections).toEqual(before.selections);
  });
  it("refuses a mailbox confirmation without its speaker authority", async () => {
    const input = await fixture();
    const { continuationToken } = await confirmedMailbox(input);
    const before = await state();
    const response = await patch(input.identityId, { jobTitle: "Rejected", continuationToken });
    expect(response.status).toBe(403);
    expect(await state()).toEqual(before);
  });
  it("refuses foreign ownership and extra organization or mailbox fields without effects", async () => {
    const input = await fixture();
    const authority = await confirmedMailbox(input);
    const foreign = await identityFor(await insertUser(env.DB, "foreign@another.example"), "Foreign organization");
    const before = await state();
    expect((await patch(foreign.identityId, { jobTitle: "Foreign", ...authority })).status).toBe(404);
    for (const extra of [
      { organizationId: input.organizationId },
      { emailId: null },
      { organizationName: "Renamed shared organization" },
    ])
      expect((await patch(input.identityId, { jobTitle: "Rejected", ...authority, ...extra })).status).toBe(400);
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
      expect((await patch(input.identityId, { jobTitle: "Rejected" }, input.headers)).status).toBe(409);
      expect(await state()).toEqual(before);
    },
  );
  it("requires the representation's selected email to remain verified", async () => {
    const input = await fixture();
    await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(input.userId).run();
    const before = await state();
    expect((await patch(input.identityId, { jobTitle: "Rejected" }, input.headers)).status).toBe(422);
    expect(await state()).toEqual(before);
  });
  it.each(["ended", "version", "mailbox", "session"] as const)(
    "rolls back title and audit when %s changes at the final batch",
    async (change) => {
      const input = await fixture();
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
    const { speakerId, token } = await speakerLink(input);
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
