import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eventProposalProofVerifyResponseSchema } from "../assets/shared/schemas/event-proposal-proof";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import {
  eventProposalProofRedemptionKey,
  issueEventProposalContinuation,
  verifyEventProposalCapability,
} from "../functions/_lib/services/event-proposal-proof-capabilities";
import { createRegistration } from "../functions/_lib/services/registrations/create";
import { addHours, nowIso } from "../functions/_lib/utils/time";
import { submitProposal } from "../functions/_lib/services/proposal-submission";
import { startEventProposalProof } from "../functions/_lib/services/event-proposal-proof";
import { getEventBySlug } from "../functions/_lib/services/events";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const post = (path: string, body: unknown, session?: string) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
async function fixture() {
  await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, "known@gmail.com");
  await env.DB.prepare("UPDATE users SET first_name='Known',last_name='Person' WHERE id=?").bind(userId).run();
  const proof = await prepareProposalProof({
    environment: env,
    eventSlug: "pqc-2026",
    email: "known@gmail.com",
    consents,
    unaffiliatedAttestation: true,
  });
  return { userId, proof, event: await getEventBySlug(env.DB, "pqc-2026") };
}
async function verificationToken(email: string) {
  const row = (
    await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=? ORDER BY rowid DESC LIMIT 1",
      email,
    )
  )[0];
  const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row.payload_json);
  return new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get("verify")!;
}
async function state() {
  return {
    users: await queryAll(
      env.DB,
      "SELECT id,normalized_email,email_verified_at,first_name,last_name FROM users ORDER BY id",
    ),
    aliases: await queryAll(env.DB, "SELECT id,user_id,normalized_email,verified_at FROM user_emails ORDER BY id"),
    identities: await queryAll(env.DB, "SELECT id,user_id,email_id,organization_id FROM identities ORDER BY id"),
    proposals: await queryAll(env.DB, "SELECT id FROM session_proposals ORDER BY id"),
    audit: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
    outbox: await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id"),
  };
}
describe("verified guest same-person additional mailbox", () => {
  it("proves another work email before linking its exact alias to the known person", async () => {
    const { proof, userId } = await fixture();
    const started = await post("/proof", {
      email: "work@official.example",
      consents,
      continuationToken: proof.continuationToken,
    });
    expect(started.status, await started.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM user_emails")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='work@official.example'")).toHaveLength(
      0,
    );
    const verified = await post("/proof/verify", { token: await verificationToken("work@official.example") });
    expect(verified.status, await verified.clone().text()).toBe(200);
    const ready = eventProposalProofVerifyResponseSchema.parse(await verified.json());
    if (ready.status !== "ready") throw new Error("Expected known canonical person after mailbox proof");
    expect(ready.person).toMatchObject({ firstName: "Known", lastName: "Person" });
    const submitted = await post(
      "",
      proposalCreateSchema.parse({
        continuationToken: ready.continuationToken,
        unaffiliatedAttestation: false,
        consents,
        proposer: { organizationName: "Official Organization" },
        proposal: {
          type: "Talk",
          title: "Same person adds an official mailbox",
          abstract:
            "A sufficiently detailed conference proposal about verified canonical person reuse, exact verified work email selection, independent organization affiliations, and atomically avoiding duplicate accounts or ownership of another person's mailbox.",
        },
      }),
    );
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    const aliases = await queryAll<{ id: string; user_id: string; verified: number }>(
      env.DB,
      "SELECT id,user_id,verified_at IS NOT NULL AS verified FROM user_emails WHERE normalized_email='work@official.example'",
    );
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ user_id: userId, verified: 1 });
    expect(await queryAll(env.DB, "SELECT user_id,email_id FROM identities WHERE organization_id IS NOT NULL")).toEqual(
      [{ user_id: userId, email_id: aliases[0].id }],
    );
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='work@official.example'")).toHaveLength(
      0,
    );
  });
  it("refuses unknown-person and wrong-owner source capabilities without queueing another mailbox", async () => {
    const { proof } = await fixture();
    const unknown = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "unknown@gmail.com",
      consents,
      unaffiliatedAttestation: true,
    });
    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email='admin@pkic.org'")
    )[0];
    const session = await createAdminSession(env.DB, admin.id, "wrong-mailbox-owner");
    const before = await state();
    expect(
      (await post("/proof", { email: "work@official.example", consents, continuationToken: unknown.continuationToken }))
        .status,
    ).toBe(403);
    expect(
      (
        await post(
          "/proof",
          { email: "work@official.example", consents, continuationToken: proof.continuationToken },
          session,
        )
      ).status,
    ).toBe(403);
    expect(await state()).toEqual(before);
  });
  it("refuses another account's primary, secondary, or pending address", async () => {
    const { proof, event } = await fixture();
    const other = await insertUser(env.DB, "other@official.example");
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), other, "alias@official.example", "alias@official.example", "2026-10-05T00:00:00.000Z")
      .run();
    const pending = await createRegistration(env.DB, {
      event,
      userId: other,
      attendanceType: "virtual",
      sourceType: "direct",
      signingSecret: env.INTERNAL_SIGNING_SECRET,
    });
    expect(pending.registration.status).toBe("pending_email_confirmation");
    await env.DB.prepare(
      "UPDATE users SET pending_email=?,pending_email_expires_at=?,pending_email_change_registration_id=? WHERE id=?",
    )
      .bind("pending@official.example", addHours(nowIso(), 1), pending.registration.id, other)
      .run();
    const before = await state();
    for (const email of ["other@official.example", "alias@official.example", "pending@official.example"])
      expect((await post("/proof", { email, consents, continuationToken: proof.continuationToken })).status).toBe(409);
    expect(await state()).toEqual(before);
  });
  it("rejects a foreign-event continuation", async () => {
    const { proof } = await fixture();
    const payload = await verifyEventProposalCapability(
      env.INTERNAL_SIGNING_SECRET!,
      proof.continuationToken,
      (await getEventBySlug(env.DB, "pqc-2026")).id,
      true,
    );
    const { expiresAt, ...receipt } = payload;
    const token = await issueEventProposalContinuation(
      env.INTERNAL_SIGNING_SECRET!,
      { ...receipt, eventId: crypto.randomUUID() },
      expiresAt,
    );
    const before = await state();
    expect((await post("/proof", { email: "work@official.example", consents, continuationToken: token })).status).toBe(
      404,
    );
    expect(await state()).toEqual(before);
  });
  it.each(["disabled", "source_mailbox", "target_owner", "consumed"] as const)(
    "refuses %s at the real email queue batch with no new effects",
    async (change) => {
      const { proof, userId, event } = await fixture();
      const payload = await verifyEventProposalCapability(
        env.INTERNAL_SIGNING_SECRET!,
        proof.continuationToken,
        event.id,
        true,
      );
      let concurrent: Awaited<ReturnType<typeof state>>;
      const db = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "disabled") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(userId).run();
        if (change === "source_mailbox")
          await env.DB.prepare(
            "UPDATE users SET email='changed@gmail.com',normalized_email='changed@gmail.com' WHERE id=?",
          )
            .bind(userId)
            .run();
        if (change === "target_owner") await insertUser(env.DB, "work@official.example");
        if (change === "consumed")
          await env.DB.prepare(
            "INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,created_at,idempotency_key) VALUES(?,'user',?,'event_mailbox_confirmed','event',?,?,?)",
          )
            .bind(
              crypto.randomUUID(),
              userId,
              event.id,
              "2026-10-05T00:00:00.000Z",
              eventProposalProofRedemptionKey(payload.capabilityId),
            )
            .run();
        concurrent = await state();
      });
      await expect(
        startEventProposalProof(db, {
          event,
          body: {
            email: "work@official.example",
            consents,
            unaffiliatedAttestation: false,
            continuationToken: proof.continuationToken,
          },
          appBaseUrl: "https://example.com",
          ttlSeconds: 1800,
          signingSecret: env.INTERNAL_SIGNING_SECRET!,
        }),
      ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_PERSON_CHANGED" });
      expect(await state()).toEqual(concurrent!);
    },
  );
  it.each(["source_mailbox", "source_consumed", "target_owner"] as const)(
    "rolls back final proposal, alias, affiliation and proof if %s changes",
    async (change) => {
      const { proof, userId, event } = await fixture();
      expect(
        (await post("/proof", { email: "work@official.example", consents, continuationToken: proof.continuationToken }))
          .status,
      ).toBe(200);
      const verified = eventProposalProofVerifyResponseSchema.parse(
        await (await post("/proof/verify", { token: await verificationToken("work@official.example") })).json(),
      );
      if (verified.status !== "ready") throw new Error("Expected known mailbox continuation");
      const original = await verifyEventProposalCapability(
        env.INTERNAL_SIGNING_SECRET!,
        proof.continuationToken,
        event.id,
        true,
      );
      const body = proposalCreateSchema.parse({
        continuationToken: verified.continuationToken,
        unaffiliatedAttestation: false,
        consents,
        proposer: { organizationName: "Official Organization" },
        proposal: {
          type: "Talk",
          title: "Atomic same person mailbox extension",
          abstract:
            "A sufficiently detailed proposal about exact verified mailbox ownership, canonical person and organization reuse, and final atomic proof guards that cannot merge another account or persist partial proposal effects after a concurrent ownership change.",
        },
      });
      let concurrent: Awaited<ReturnType<typeof state>>;
      const db = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "source_mailbox")
          await env.DB.prepare(
            "UPDATE users SET email='changed@gmail.com',normalized_email='changed@gmail.com' WHERE id=?",
          )
            .bind(userId)
            .run();
        if (change === "target_owner") await insertUser(env.DB, "work@official.example");
        if (change === "source_consumed")
          await env.DB.prepare(
            "INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,created_at,idempotency_key) VALUES(?,'user',?,'event_mailbox_confirmed','event',?,?,?)",
          )
            .bind(
              crypto.randomUUID(),
              userId,
              event.id,
              "2026-10-05T00:00:00.000Z",
              eventProposalProofRedemptionKey(original.capabilityId),
            )
            .run();
        concurrent = await state();
      });
      await expect(
        submitProposal(db, {
          event,
          body,
          appBaseUrl: "https://app.test",
          signingSecret: env.INTERNAL_SIGNING_SECRET!,
          referralCodeLength: 8,
          proposalDetails: {},
          ip: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await state()).toEqual(concurrent!);
      expect(await queryAll(env.DB, "SELECT id FROM organizations")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toHaveLength(0);
    },
  );
});
