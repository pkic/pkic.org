import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eventProposalProofIdentityPatchResponseSchema } from "../assets/shared/schemas/event-proposal-proof";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { updateEventProposalOwnIdentity } from "../functions/_lib/services/event-proposal-proof-identity";
import { nowIso } from "../functions/_lib/utils/time";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertOrganization, insertUser } from "./helpers/membership";
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
    snapshots: await queryAll(
      env.DB,
      "SELECT id,acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json FROM proposal_speakers ORDER BY id",
    ),
    publications: await queryAll(env.DB, "SELECT id,snapshot_json FROM event_agenda_publications ORDER BY id"),
    audit: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
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
    expect(JSON.parse(before.snapshots[0].acting_identity_snapshot_json as string).jobTitle).toBe("Original role");
    const response = await patch(input.identityId, {
      jobTitle: "Updated own role",
      continuationToken: proof.continuationToken,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await response.json())).toEqual({
      identityId: input.identityId,
      jobTitle: "Updated own role",
    });
    const after = await state();
    expect(after.organizations).toEqual(before.organizations);
    expect(after.snapshots).toEqual(before.snapshots);
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
  it("allows signed-in nonmember ownership and an explicit role clear", async () => {
    const input = await fixture();
    const session = await createMemberSession(env.DB, input.userId, "nonmember-own-role", undefined, input.identityId);
    const response = await patch(input.identityId, { jobTitle: null }, session);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await response.json())).toEqual({
      identityId: input.identityId,
      jobTitle: null,
    });
    expect(await queryAll(env.DB, "SELECT id FROM members")).toHaveLength(0);
  });
  it("accepts the current invited speaker's own capability without altering its selected snapshot", async () => {
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
    expect((await state()).snapshots).toEqual(before.snapshots);
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
