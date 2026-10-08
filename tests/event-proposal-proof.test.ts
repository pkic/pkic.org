import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { prepareProposalProof } from "./helpers/proposal-proof";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { eventProposalProofVerifyResponseSchema } from "../assets/shared/schemas/event-proposal-proof";
import { getEventBySlug } from "../functions/_lib/services/events";
import { submitProposal } from "../functions/_lib/services/proposal-submission";
import { createMemberSession } from "./helpers/auth";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { getSpeakerByManageToken } from "../functions/_lib/services/proposals";
import { resolveEmailTemplateData } from "../functions/_lib/email/plain-text";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const request = (suffix: string, body: unknown, session?: string) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
function proposal(
  proof: { continuationToken: string; unaffiliatedAttestation: boolean },
  proposer: Record<string, unknown>,
) {
  return proposalCreateSchema.parse({
    ...proof,
    proposer,
    proposal: {
      type: "Talk",
      title: "A verified proposal submission",
      abstract:
        "A detailed conference proposal covering verified human participation, canonical affiliation, current terms, and the exact atomic boundary that prevents stale email proof or consent from changing another person's profile.",
    },
    consents,
  });
}
async function start(email: string, options: { session?: string; unaffiliatedAttestation?: boolean } = {}) {
  const response = await request(
    "/proof",
    { email, consents, unaffiliatedAttestation: options.unaffiliatedAttestation ?? false },
    options.session,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const row = await env.DB.prepare(
    "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=? ORDER BY rowid DESC LIMIT 1",
  )
    .bind(email)
    .first<{ payload_json: string }>();
  const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row!.payload_json);
  return new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get("verify")!;
}

describe("event proposal mailbox proof", () => {
  it("requires current terms before queueing and returns the same start response for known and new mailboxes", async () => {
    await seedEventAndAdmin(env.DB);
    await insertUser(env.DB, "known@official.example");
    expect((await request("/proof", { email: "known@official.example", consents: [] })).status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    for (const email of ["known@official.example", "new@official.example"]) {
      const response = await request("/proof", { email, consents });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "verification_sent" });
    }
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT normalized_email FROM users WHERE normalized_email='new@official.example'"),
    ).toHaveLength(0);
  });

  it("allows an event with no speaker terms while retaining the joining qualifier's personal-email attestation", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE event_terms SET active=0 WHERE event_id=? AND audience_type='speaker'")
      .bind(eventId)
      .run();
    expect(await (await request("/proof", { email: "guest@gmail.com", consents: [] })).json()).toEqual({
      status: "unaffiliated_attestation_required",
    });
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "guest@gmail.com",
      consents: [],
      unaffiliatedAttestation: true,
    });
    const response = await request("", {
      ...proposal(proof, { firstName: "Guest", lastName: "Person" }),
      consents: [],
    });
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("requires mailbox proof before known-person reuse and rejects unverified secondary reservations", async () => {
    await seedEventAndAdmin(env.DB);
    const userId = await insertUser(env.DB, "known@official.example");
    await env.DB.prepare("UPDATE users SET first_name='Known',last_name='Person' WHERE id=?").bind(userId).run();
    const rejected = await request(
      "",
      proposalCreateSchema.parse({
        proposer: { email: "known@official.example" },
        proposal: {
          type: "Talk",
          title: "A mailbox owner must confirm",
          abstract:
            "A sufficiently detailed proposal abstract about safe verified identity reuse, canonical person profiles, and privacy preserving mailbox confirmation for all public event submission workflows.",
        },
        consents,
      }),
    );
    expect(rejected.status).toBe(403);
    await env.DB.prepare(
      "INSERT INTO user_emails (id,user_id,email,normalized_email,created_at) VALUES (?,?,?,?,datetime('now'))",
    )
      .bind(crypto.randomUUID(), userId, "reserved@official.example", "reserved@official.example")
      .run();
    const token = await start("reserved@official.example");
    const response = await request("/proof/verify", { token });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "support_required" });
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
  });

  it("reuses a known person's names without duplicate input and limits the proof catalog to its owner", async () => {
    await seedEventAndAdmin(env.DB);
    const userId = await insertUser(env.DB, "known@official.example");
    await env.DB.prepare("UPDATE users SET first_name='Known',last_name='Person' WHERE id=?").bind(userId).run();
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "known@official.example",
      consents,
      unaffiliatedAttestation: true,
    });
    const response = await request("", proposal(proof, { actingIdentityId: null }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT proposer_user_id FROM session_proposals")).toEqual([
      { proposer_user_id: userId },
    ]);
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", [userId])).toEqual([
      { first_name: "Known", last_name: "Person" },
    ]);
    expect((await request("/proof/identities", { continuationToken: proof.continuationToken })).status).toBe(409);
    expect((await request("", proposal(proof, { actingIdentityId: null }))).status).toBe(409);
  });

  it("derives member capacity from a completed canonical organization link without a membership application", async () => {
    await seedEventAndAdmin(env.DB);
    const organizationId = await insertOrganization(env.DB, "Canonical organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await env.DB.prepare(
      "INSERT INTO organization_domain_claims (id,domain,application_id,organization_id,created_at,updated_at) VALUES (?,'official.example',NULL,?,datetime('now'),datetime('now'))",
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "new@official.example",
      consents,
      unaffiliatedAttestation: false,
    });
    const response = await request("", proposal(proof, { firstName: "New", lastName: "Person" }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT capacity.member_id FROM identity_member_capacities capacity JOIN identities identity ON identity.id=capacity.identity_id JOIN users user ON user.id=identity.user_id WHERE user.normalized_email='new@official.example'",
      ),
    ).toEqual([{ member_id: memberId }]);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });

  it("paginates only the proved person's active organization affiliations even when caller filters request another person", async () => {
    await seedEventAndAdmin(env.DB);
    const userId = await insertUser(env.DB, "owner@official.example");
    const otherId = await insertUser(env.DB, "other@official.example");
    const ids: string[] = [];
    for (const name of ["First owned organization", "Second owned organization"]) {
      const organization = await insertOrganization(env.DB, name);
      const member = await seedOrganizationAggregate(env.DB, organization, "A");
      ids.push(await addRepresentative(env.DB, member, userId));
      await addRepresentative(env.DB, member, otherId);
    }
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "owner@official.example",
      consents,
      unaffiliatedAttestation: false,
    });
    const pages = (await Promise.all(
      [0, 1].map((offset) =>
        request(`/proof/identities?limit=1&offset=${offset}`, { continuationToken: proof.continuationToken }).then(
          (r) => r.json(),
        ),
      ),
    )) as Array<{ identities: Array<{ id: string; userId: string }>; page: { total: number } }>;
    expect(pages.flatMap((p) => p.identities.map((i) => i.id)).sort()).toEqual(ids.sort());
    expect(
      pages.every((p) => p.page.total === 2 && p.identities.length === 1 && p.identities[0].userId === userId),
    ).toBe(true);
    const foreign = await request(`/proof/identities?userId=${otherId}`, {
      continuationToken: proof.continuationToken,
    });
    expect(await foreign.json()).toMatchObject({ identities: [], page: { total: 0 } });
  });

  it("adds a newly proved official mailbox to the same signed-in person and refuses another person's address", async () => {
    await seedEventAndAdmin(env.DB);
    const userId = await insertUser(env.DB, "person@gmail.com");
    await env.DB.prepare("UPDATE users SET first_name='Same',last_name='Person' WHERE id=?").bind(userId).run();
    const initial = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "person@gmail.com",
      consents,
      unaffiliatedAttestation: true,
    });
    const participation = await request("", proposal(initial, { actingIdentityId: null }));
    expect(participation.status, await participation.clone().text()).toBe(200);
    const session = await createMemberSession(env.DB, userId, crypto.randomUUID());
    const token = await start("new@official.example", { session });
    expect((await request("/proof/verify", { token })).status).toBe(403);
    const ready = eventProposalProofVerifyResponseSchema.parse(
      await (await request("/proof/verify", { token }, session)).json(),
    );
    if (ready.status !== "ready") throw new Error("Expected own mailbox continuation");
    const response = await request(
      "",
      proposal(
        { continuationToken: ready.continuationToken, unaffiliatedAttestation: false },
        { organizationName: "New official organization" },
      ),
      session,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT user_id,verified_at IS NOT NULL AS verified FROM user_emails WHERE normalized_email='new@official.example'",
      ),
    ).toEqual([{ user_id: userId, verified: 1 }]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='new@official.example'")).toHaveLength(
      0,
    );
    await insertUser(env.DB, "foreign@another.example");
    const foreignToken = await start("foreign@another.example", { session });
    expect(await (await request("/proof/verify", { token: foreignToken }, session)).json()).toEqual({
      status: "support_required",
    });
  });

  it("rolls back proof redemption, user, consent, and outbox when current terms change at the final batch", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "new@example.test",
      consents,
      unaffiliatedAttestation: true,
    });
    const body = proposal(proof, { firstName: "New", lastName: "Person", actingIdentityId: null });
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        "UPDATE event_terms SET display_text='Revised content' WHERE event_id=? AND audience_type='speaker'",
      )
        .bind(eventId)
        .run(),
    );
    await expect(
      submitProposal(db, {
        event: await getEventBySlug(env.DB, "pqc-2026"),
        body,
        appBaseUrl: "https://app.test",
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        referralCodeLength: 8,
        proposalDetails: {},
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_TERMS_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='new@example.test'")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE idempotency_key LIKE 'event_proposal_proof_consumed:%'"),
    ).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='proposal_submitted'")).toHaveLength(
      0,
    );
  });

  it("rolls back the proposal and proof when a missing canonical name is filled before the final batch", async () => {
    await seedEventAndAdmin(env.DB);
    const userId = await insertUser(env.DB, "missing-name@example.test");
    await env.DB.prepare("UPDATE users SET first_name=NULL,last_name='Canonical' WHERE id=?").bind(userId).run();
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "missing-name@example.test",
      consents,
      unaffiliatedAttestation: true,
    });
    const body = proposal(proof, { firstName: "Submitted", actingIdentityId: null });
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET first_name='Concurrent' WHERE id=?").bind(userId).run(),
    );
    await expect(
      submitProposal(db, {
        event: await getEventBySlug(env.DB, "pqc-2026"),
        body,
        appBaseUrl: "https://app.test",
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        referralCodeLength: 8,
        proposalDetails: {},
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_IDENTITY_CHANGED" });
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", [userId])).toEqual([
      { first_name: "Concurrent", last_name: "Canonical" },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE idempotency_key LIKE 'event_proposal_proof_consumed:%'"),
    ).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='proposal_submitted'")).toHaveLength(
      0,
    );
    const retry = await request("", proposal(proof, { actingIdentityId: null }));
    expect(retry.status, await retry.clone().text()).toBe(200);
    const mail = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key='proposal_submitted' AND recipient_user_id=?",
    )
      .bind(userId)
      .first<{ payload_json: string }>();
    expect(resolveEmailTemplateData(JSON.parse(mail!.payload_json), "text")).toMatchObject({
      firstName: "Concurrent",
      lastName: "Canonical",
    });
  });

  it("delivers a new work-mailbox proof without a stored speaker token and resumes only the original live speaker scope", async () => {
    await seedEventAndAdmin(env.DB);
    const initial = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "invited@gmail.com",
      consents,
      unaffiliatedAttestation: true,
    });
    const submitted = await request(
      "",
      proposal(initial, { firstName: "Invited", lastName: "Person", actingIdentityId: null }),
    );
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    const { proposalId } = (await submitted.json()) as { proposalId: string };
    const speaker = await env.DB.prepare("SELECT id,user_id FROM proposal_speakers WHERE proposal_id=?")
      .bind(proposalId)
      .first<{ id: string; user_id: string }>();
    const original = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "speaker_manage",
      resourceId: speaker!.id,
    });
    const started = await request("/proof", {
      email: "invited@official.example",
      consents,
      speakerManagementToken: original,
    });
    expect(started.status, await started.clone().text()).toBe(200);
    const row = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email='invited@official.example'",
    ).first<{ payload_json: string }>();
    expect(row!.payload_json).not.toContain(original);
    const delivered = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row!.payload_json);
    const url = new URL(delivered.verificationUrl);
    expect(url.searchParams.has("token")).toBe(false);
    const token = new URLSearchParams(url.hash.slice(1)).get("verify")!;
    const response = await request("/proof/verify", { token });
    expect(response.status, await response.clone().text()).toBe(200);
    const ready = eventProposalProofVerifyResponseSchema.parse(await response.json());
    if (ready.status !== "ready" || !ready.speakerManagementToken || !ready.speakerManageUrl)
      throw new Error("Expected canonical speaker continuation");
    expect(
      (await getSpeakerByManageToken(env.DB, ready.speakerManagementToken, env.INTERNAL_SIGNING_SECRET!)).speaker
        .user_id,
    ).toBe(speaker!.user_id);
    expect(
      (
        await request(
          "",
          proposal(
            { continuationToken: ready.continuationToken, unaffiliatedAttestation: false },
            { organizationName: "Official organization" },
          ),
        )
      ).status,
    ).toBe(403);
    expect((await request("/proof/verify", { token })).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_emails WHERE normalized_email='invited@official.example'"),
    ).toHaveLength(0);
    await env.DB.prepare("UPDATE proposal_speakers SET manage_link_secret='revoked' WHERE id=?")
      .bind(speaker!.id)
      .run();
    expect((await request("/proof/verify", { token })).status).toBe(403);
  });
});
