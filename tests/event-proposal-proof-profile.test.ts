import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventProposalPersonNamePatchSchema,
  eventProposalProofPersonPatchResponseSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { updateEventProposalProofPerson } from "../functions/_lib/services/event-proposal-proof-profile";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const patch = (body: unknown, session?: string, slug = "pqc-2026") =>
  callApi(env, `/api/v1/events/${slug}/proposals/proof/person`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, "owner@official.example");
  await env.DB.prepare(
    "UPDATE users SET first_name='Original',last_name='Person',biography='Canonical biography' WHERE id=?",
  )
    .bind(userId)
    .run();
  const proof = await prepareProposalProof({
    environment: env,
    eventSlug: "pqc-2026",
    email: "owner@official.example",
    consents,
    unaffiliatedAttestation: true,
  });
  return { eventId, userId, proof };
}
async function unchangedState() {
  return {
    users: await queryAll(
      env.DB,
      "SELECT id,normalized_email,first_name,last_name,email_verified_at FROM users ORDER BY id",
    ),
    identities: await queryAll(env.DB, "SELECT id,user_id,organization_id,job_title FROM identities ORDER BY id"),
    organizations: await queryAll(env.DB, "SELECT id,name FROM organizations ORDER BY id"),
    proposals: await queryAll(env.DB, "SELECT id FROM session_proposals ORDER BY id"),
    audit: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
    outbox: await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id"),
  };
}
describe("confirmed proposal person name editing", () => {
  it("shares strict canonical name validation and excludes representation changes", () => {
    expect(eventProposalPersonNamePatchSchema.parse({ firstName: "  Saved  " })).toEqual({ firstName: "Saved" });
    for (const body of [
      {},
      { firstName: "" },
      { firstName: "Valid", organizationName: "Employer" },
      { firstName: "Valid", actingIdentityId: null },
    ])
      expect(eventProposalPersonNamePatchSchema.safeParse(body).success).toBe(false);
  });
  it("saves the verified guest's known person and leaves the continuation usable for submission", async () => {
    const { userId, proof } = await fixture();
    const before = await unchangedState();
    const response = await patch({ ...proof, unaffiliatedAttestation: undefined, firstName: "Corrected" });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = eventProposalProofPersonPatchResponseSchema.parse(await response.json());
    expect(result.person).toMatchObject({
      email: "owner@official.example",
      firstName: "Corrected",
      lastName: "Person",
      bio: "Canonical biography",
      organizationName: null,
      jobTitle: null,
    });
    const after = await unchangedState();
    expect(after.identities).toEqual(before.identities);
    expect(after.organizations).toEqual(before.organizations);
    expect(after.proposals).toEqual(before.proposals);
    expect(after.outbox).toEqual(before.outbox);
    expect(after.audit).toHaveLength(before.audit.length + 1);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE idempotency_key LIKE 'event_proposal_proof_consumed:%'"),
    ).toHaveLength(0);
    const submitted = await callApi(env, "/api/v1/events/pqc-2026/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        proposalCreateSchema.parse({
          ...proof,
          proposer: { actingIdentityId: null },
          consents,
          proposal: {
            type: "Talk",
            title: "A corrected canonical person submits",
            abstract:
              "A sufficiently detailed proposal about canonical personal information, independent organization representations, verified mailbox ownership, and atomic updates that retain approved public appearances and prior historical snapshots.",
          },
        }),
      ),
    });
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", userId)).toEqual([
      { first_name: "Corrected", last_name: "Person" },
    ]);
  });
  it("allows a canonical signed-in owner without requiring any membership", async () => {
    await seedEventAndAdmin(env.DB);
    const user = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email='admin@pkic.org'")
    )[0];
    const session = await createAdminSession(env.DB, user.id, "own-name-session");
    expect(await queryAll(env.DB, "SELECT id FROM members")).toHaveLength(0);
    const response = await patch({ firstName: "Own", lastName: "Person" }, session);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(eventProposalProofPersonPatchResponseSchema.parse(await response.json()).person).toMatchObject({
      firstName: "Own",
      lastName: "Person",
    });
    expect(await queryAll(env.DB, "SELECT id FROM members")).toHaveLength(0);
  });
  it("refuses missing authority, malformed proof, and unknown person without creating records", async () => {
    await seedEventAndAdmin(env.DB);
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "unknown@official.example",
      consents,
      unaffiliatedAttestation: true,
    });
    const before = await unchangedState();
    expect((await patch({ firstName: "Unauthorized" })).status).toBe(401);
    expect((await patch({ firstName: "Unauthorized", continuationToken: "a".repeat(40) })).status).toBe(404);
    expect((await patch({ firstName: "Unauthorized", continuationToken: proof.continuationToken })).status).toBe(403);
    expect(await unchangedState()).toEqual(before);
  });
  it("does not downgrade a presented invalid session or let another actor use a guest proof", async () => {
    const { proof } = await fixture();
    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email='admin@pkic.org'")
    )[0];
    const session = await createAdminSession(env.DB, admin.id, "foreign-name-session");
    const before = await unchangedState();
    expect((await patch({ firstName: "Foreign", continuationToken: proof.continuationToken }, session)).status).toBe(
      403,
    );
    expect((await patch({ firstName: "Foreign", continuationToken: proof.continuationToken }, "invalid")).status).toBe(
      401,
    );
    expect(await unchangedState()).toEqual(before);
  });
  it.each(["names", "disabled", "mailbox", "terms"] as const)(
    "rolls back own-name and audit writes when %s changes at the final batch",
    async (change) => {
      const { eventId, userId, proof } = await fixture();
      let concurrent: Awaited<ReturnType<typeof unchangedState>>;
      const db = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "names")
          await env.DB.prepare("UPDATE users SET first_name='Concurrent' WHERE id=?").bind(userId).run();
        if (change === "disabled") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(userId).run();
        if (change === "mailbox")
          await env.DB.prepare(
            "UPDATE users SET email='changed@official.example',normalized_email='changed@official.example' WHERE id=?",
          )
            .bind(userId)
            .run();
        if (change === "terms")
          await env.DB.prepare("UPDATE event_terms SET version='v2' WHERE event_id=? AND audience_type='speaker'")
            .bind(eventId)
            .run();
        concurrent = await unchangedState();
      });
      await expect(
        updateEventProposalProofPerson(db, {
          eventId,
          signingSecret: env.INTERNAL_SIGNING_SECRET!,
          body: { firstName: "Rejected", continuationToken: proof.continuationToken },
        }),
      ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_PERSON_CHANGED" });
      expect(await unchangedState()).toEqual(concurrent!);
    },
  );
  it("rejects a session revoked at the final name-write batch", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const user = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email='admin@pkic.org'")
    )[0];
    await createAdminSession(env.DB, user.id, "revoked-name-session");
    const session = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM sessions WHERE user_id=?", user.id))[0];
    const before = await unchangedState();
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET revoked_at='2026-10-05T00:00:00.000Z' WHERE id=?").bind(session.id).run(),
    );
    await expect(
      updateEventProposalProofPerson(db, {
        eventId,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        actor: { userId: user.id, sessionId: session.id },
        body: { firstName: "Rejected" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_PERSON_CHANGED" });
    expect(await unchangedState()).toEqual(before);
  });
});
