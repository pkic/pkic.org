import { personNamePatchSchema } from "../assets/shared/schemas/api-common";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventProposalProofPersonPatchResponseSchema,
  eventProposalProofPersonPatchSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { updateEventProposalProofPerson } from "../functions/_lib/services/event-proposal-proof-profile";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { signInProposer } from "./helpers/proposal-proof";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const patch = (body: unknown, headers: Record<string, string> = {}) =>
  callApi(env, "/api/v1/events/pqc-2026/proposals/proof/person", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
/** A signed-in person whose individual identity carries their biography. */
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const person = await signInProposer({
    environment: env,
    email: "owner@official.example",
    firstName: "Original",
    lastName: "Person",
  });
  await env.DB.prepare(
    `INSERT INTO identities (id, user_id, organization_id, biography, source, show_on_organization_profile,
                             invited_at, started_at, created_at, updated_at)
     VALUES (?1, ?2, NULL, 'Canonical biography', 'account', 0, ?3, ?3, ?3, ?3)`,
  )
    .bind(crypto.randomUUID(), person.userId, "2026-10-05T00:00:00.000Z")
    .run();
  const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?")
    .bind(person.userId)
    .first<string>("id");
  return { eventId, ...person, sessionId: sessionId! };
}
async function makePublicMember(userId: string) {
  const memberId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB));
  await addRepresentative(env.DB, memberId, userId);
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
    publicationRequests: await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY sequence"),
  };
}
describe("signed-in proposal person name editing", () => {
  it("shares strict canonical name validation and excludes representation changes", () => {
    expect(personNamePatchSchema.parse({ firstName: "  Saved  " })).toEqual({ firstName: "Saved" });
    for (const body of [
      {},
      { firstName: "" },
      { firstName: "Valid", organizationName: "Employer" },
      { firstName: "Valid", actingIdentityId: null },
    ])
      expect(personNamePatchSchema.safeParse(body).success).toBe(false);
  });
  it("saves the signed-in person's own name without touching identities, organizations or memberships", async () => {
    const { userId, headers } = await fixture();
    const before = await unchangedState();
    const response = await patch(eventProposalProofPersonPatchSchema.parse({ firstName: "Corrected" }), headers);
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
    expect(await queryAll(env.DB, "SELECT id FROM members")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", userId)).toEqual([
      { first_name: "Corrected", last_name: "Person" },
    ]);
  });
  it("queues changed public member names and keeps repeated saves quiet", async () => {
    const { userId, headers } = await fixture();
    await makePublicMember(userId);
    const body = eventProposalProofPersonPatchSchema.parse({ firstName: "Published" });
    const saved = await patch(body, headers);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual([
      { resource_id: userId, reason_code: "user_profile_changed" },
    ]);
    const repeated = await patch(body, headers);
    expect(repeated.status, await repeated.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
  });
  it("requires a session and takes no mailbox confirmation in its place", async () => {
    const { headers } = await fixture();
    const before = await unchangedState();
    expect((await patch({ firstName: "Unauthorized" })).status).toBe(401);
    for (const authority of [{ continuationToken: "a".repeat(40) }, { speakerManagementToken: "a".repeat(40) }]) {
      expect(eventProposalProofPersonPatchSchema.safeParse({ firstName: "Unauthorized", ...authority }).success).toBe(
        false,
      );
      expect((await patch({ firstName: "Unauthorized", ...authority }, headers)).status).toBe(400);
    }
    expect(await unchangedState()).toEqual(before);
  });
  it.each(["names", "disabled"] as const)(
    "rolls back own-name and audit writes when %s changes at the final batch",
    async (change) => {
      const { eventId, userId, sessionId } = await fixture();
      await makePublicMember(userId);
      let concurrent: Awaited<ReturnType<typeof unchangedState>>;
      const db = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "names")
          await env.DB.prepare("UPDATE users SET first_name='Concurrent' WHERE id=?").bind(userId).run();
        if (change === "disabled") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(userId).run();
        concurrent = await unchangedState();
      });
      await expect(
        updateEventProposalProofPerson(db, {
          eventId,
          signingSecret: env.INTERNAL_SIGNING_SECRET!,
          actor: { userId, sessionId },
          body: { firstName: "Rejected" },
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
