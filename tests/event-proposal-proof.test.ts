import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { prepareProposalProof, signInProposer } from "./helpers/proposal-proof";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication } from "./helpers/member-applications";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { proposalCreateResponseSchema, proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import {
  eventProposalProofIdentitiesSchema,
  eventProposalProofStartSchema,
  eventProposalProofVerifyResponseSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { identitiesListResponseSchema } from "../assets/shared/schemas/identity";
import { getEventBySlug } from "../functions/_lib/services/events";
import { submitProposal } from "../functions/_lib/services/proposal-submission";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { getSpeakerByManageToken } from "../functions/_lib/services/proposals";
import { resolveEmailTemplateData } from "../functions/_lib/email/plain-text";
import { withIndependentCapacity } from "./helpers/independent-capacity";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const request = (suffix: string, body: unknown, headers: Record<string, string> = {}) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
/** A proposal by a signed-in person in their individual capacity unless `proposer` names an identity. */
function proposal(proposer: Record<string, unknown> = {}, accepted = consents) {
  const chosen = { actingIdentityId: null, ...proposer };
  return proposalCreateSchema.parse({
    ...withIndependentCapacity({ unaffiliatedAttestation: chosen.actingIdentityId === null }),
    proposer: chosen,
    proposal: {
      type: "Talk",
      title: "A verified proposal submission",
      abstract:
        "A detailed conference proposal covering verified human participation, canonical affiliation, current terms, and the exact atomic boundary that prevents stale email proof or consent from changing another person's profile.",
    },
    consents: accepted,
  });
}
/** The signed-in person as the submission service receives them from the route. */
async function actorOf(userId: string) {
  const row = await env.DB.prepare(
    "SELECT session.id,session.expires_at,user.normalized_email FROM sessions session JOIN users user ON user.id=session.user_id WHERE session.user_id=?",
  )
    .bind(userId)
    .first<{ id: string; expires_at: string; normalized_email: string }>();
  return { userId, email: row!.normalized_email, sessionId: row!.id, expiresAt: row!.expires_at };
}
/** A signed-in person's own proposal and the speaker link to their place on it. */
async function speakerLink(email: string) {
  const person = await signInProposer({ environment: env, email, firstName: "Link", lastName: "Speaker" });
  const submitted = await request("", proposal(), person.headers);
  expect(submitted.status, await submitted.clone().text()).toBe(200);
  const { proposalId } = proposalCreateResponseSchema.parse(await submitted.json());
  const speaker = await env.DB.prepare("SELECT id,user_id FROM proposal_speakers WHERE proposal_id=?")
    .bind(proposalId)
    .first<{ id: string; user_id: string }>();
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "speaker_manage",
    resourceId: speaker!.id,
  });
  return { ...person, speaker: speaker!, token };
}
const verifyEmails = (email: string) =>
  queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=? ORDER BY rowid DESC",
    email,
  );
/** Starts a speaker's mailbox confirmation and reads its link from the delivered email. */
async function start(email: string, speakerManagementToken: string) {
  const response = await request(
    "/proof",
    eventProposalProofStartSchema.parse({ email, consents, speakerManagementToken }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const mail = await deliveredEmailPayload<{ verificationUrl: string }>(
    env.DB,
    env,
    (await verifyEmails(email))[0].payload_json,
  );
  return new URL(mail.verificationUrl);
}
const verifyToken = (url: URL) => new URLSearchParams(url.hash.slice(1)).get("verify")!;

describe("proposal submission by a signed-in person", () => {
  it("answers a submission without a session with a sign-in requirement and stores nothing", async () => {
    await seedEventAndAdmin(env.DB);
    const users = await queryAll(env.DB, "SELECT id FROM users");
    const response = await request("", proposal({ firstName: "Guest", lastName: "Person" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM users")).toEqual(users);
    expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("stores private notes for the program committee apart from the published abstract", async () => {
    await seedEventAndAdmin(env.DB);
    const person = await signInProposer({ environment: env, email: "notes@gmail.com" });
    const body = proposal({ firstName: "Notes", lastName: "Person" });
    expect(
      proposalCreateSchema.safeParse({ ...body, proposal: { ...body.proposal, committeeNotes: "x".repeat(4001) } })
        .success,
    ).toBe(false);
    const response = await request(
      "",
      { ...body, proposal: { ...body.proposal, committeeNotes: "  Happy to shorten this to a lightning talk.  " } },
      person.headers,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT abstract, committee_notes FROM session_proposals")).toEqual([
      { abstract: body.proposal.abstract, committee_notes: "Happy to shorten this to a lightning talk." },
    ]);
  });

  it("allows an event with no speaker terms", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE event_terms SET active=0 WHERE event_id=? AND audience_type='speaker'")
      .bind(eventId)
      .run();
    const person = await signInProposer({ environment: env, email: "guest@gmail.com" });
    const response = await request("", proposal({ firstName: "Guest", lastName: "Person" }, []), person.headers);
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("reuses a known person's names without duplicate input", async () => {
    await seedEventAndAdmin(env.DB);
    const person = await signInProposer({
      environment: env,
      email: "known@official.example",
      firstName: "Known",
      lastName: "Person",
    });
    const response = await request("", proposal(), person.headers);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT proposer_user_id FROM session_proposals")).toEqual([
      { proposer_user_id: person.userId },
    ]);
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", [person.userId])).toEqual([
      { first_name: "Known", last_name: "Person" },
    ]);
  });

  it("rolls back the proposal, consent, and outbox when current terms change at the final batch", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const person = await signInProposer({ environment: env, email: "new@example.test" });
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
        body: proposal({ firstName: "New", lastName: "Person" }),
        actor: await actorOf(person.userId),
        appBaseUrl: "https://app.test",
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        referralCodeLength: 8,
        proposalDetails: {},
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_TERMS_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", [person.userId])).toEqual([
      { first_name: null, last_name: null },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='proposal_submitted'")).toHaveLength(
      0,
    );
  });

  it("rolls back the proposal when a missing canonical name is filled before the final batch", async () => {
    await seedEventAndAdmin(env.DB);
    const userId = await insertUser(env.DB, "missing-name@example.test");
    await env.DB.prepare("UPDATE users SET first_name=NULL,last_name='Canonical' WHERE id=?").bind(userId).run();
    const person = await signInProposer({ environment: env, email: "missing-name@example.test" });
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET first_name='Concurrent' WHERE id=?").bind(userId).run(),
    );
    await expect(
      submitProposal(db, {
        event: await getEventBySlug(env.DB, "pqc-2026"),
        body: proposal({ firstName: "Submitted" }),
        actor: await actorOf(userId),
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
    expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='proposal_submitted'")).toHaveLength(
      0,
    );
    const retry = await request("", proposal(), person.headers);
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
});

describe("speaker mailbox proof", () => {
  it("refuses to confirm an address without a speaker authority and queues no email", async () => {
    await seedEventAndAdmin(env.DB);
    const person = await signInProposer({ environment: env, email: "person@official.example" });
    const body = eventProposalProofStartSchema.parse({ email: "new@official.example", consents });
    for (const headers of [{}, person.headers]) {
      const response = await request("/proof", body, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "PROPOSAL_PROOF_CONTEXT_MISMATCH" } });
    }
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("refuses a verification request when its active template has no body", async () => {
    await seedEventAndAdmin(env.DB);
    const link = await speakerLink("speaker@gmail.com");
    await env.DB.prepare(
      "UPDATE email_template_versions SET body = '' WHERE template_key = 'event_proposal_verify'",
    ).run();
    const response = await request(
      "/proof",
      eventProposalProofStartSchema.parse({
        email: "template-check@official.example",
        consents,
        speakerManagementToken: link.token,
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "EMAIL_TEMPLATE_UNAVAILABLE" } });
    expect(await verifyEmails("template-check@official.example")).toHaveLength(0);
  });

  it("requires current terms before queueing and returns the same start response for known and new mailboxes", async () => {
    await seedEventAndAdmin(env.DB);
    const link = await speakerLink("speaker@gmail.com");
    await insertUser(env.DB, "known@official.example");
    for (const body of [{ email: "known@official.example" }, { email: "known@official.example", consents: [] }]) {
      expect((await request("/proof", { ...body, speakerManagementToken: link.token })).status).toBe(400);
    }
    expect(await verifyEmails("known@official.example")).toHaveLength(0);
    for (const email of ["known@official.example", "new@official.example"]) {
      const response = await request(
        "/proof",
        eventProposalProofStartSchema.parse({ email, consents, speakerManagementToken: link.token }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "verification_sent" });
    }
    expect(
      await queryAll(env.DB, "SELECT normalized_email FROM users WHERE normalized_email='new@official.example'"),
    ).toHaveLength(0);
  });

  it("records the terms agreed before the email step and returns them with the confirmation", async () => {
    await seedEventAndAdmin(env.DB);
    const link = await speakerLink("speaker@gmail.com");
    const token = verifyToken(await start("new@official.example", link.token));
    const response = await request("/proof/verify", { token });
    expect(response.status, await response.clone().text()).toBe(200);
    const ready = eventProposalProofVerifyResponseSchema.parse(await response.json());
    if (ready.status !== "ready") throw new Error("Expected a ready confirmation");
    expect(ready.consents).toEqual(consents);
  });

  it("requires review for a differently named organization on a reserved domain", async () => {
    await seedEventAndAdmin(env.DB);
    const link = await speakerLink("dana@gmail.com");
    const pending = await seedMemberApplication({ applicantEmail: "pending@held-domain.example" });
    const token = verifyToken(await start("dana@held-domain.example", link.token));
    const response = await request("/proof/verify", { token });
    expect(response.status).toBe(200);
    const proof = eventProposalProofVerifyResponseSchema.parse(await response.json());
    expect(proof).toMatchObject({
      status: "ready",
      email: "dana@held-domain.example",
      applicantKind: "organization",
      affiliation: { reviewRequired: true, organization: null, organizations: [] },
    });
    const selected = await request("/proof/verify", {
      token,
      affiliation: {
        organizationId: null,
        organizationName: "Different Organization",
        domain: "held-domain.example",
        jobTitle: "Researcher",
      },
    });
    expect(selected.status, await selected.clone().text()).toBe(409);
    expect(await selected.json()).toMatchObject({ error: { code: "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED" } });
    expect(
      await queryAll(
        env.DB,
        "SELECT claim.application_id,claim.organization_id FROM organization_domain_claims claim WHERE domain=?",
        ["held-domain.example"],
      ),
    ).toEqual([{ application_id: pending, organization_id: null }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_emails WHERE normalized_email=?", ["dana@held-domain.example"]),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM organizations WHERE name='Different Organization'")).toEqual([]);
  });

  it("paginates only the proved person's active organization affiliations even when caller filters request another person", async () => {
    await seedEventAndAdmin(env.DB);
    const link = await speakerLink("owner@official.example");
    const otherId = await insertUser(env.DB, "other@official.example");
    const ids: string[] = [];
    for (const name of ["First owned organization", "Second owned organization"]) {
      const organization = await insertOrganization(env.DB, name);
      const member = await seedOrganizationAggregate(env.DB, organization, "A");
      ids.push(await addRepresentative(env.DB, member, link.userId));
      await addRepresentative(env.DB, member, otherId);
    }
    const proof = await prepareProposalProof({
      environment: env,
      eventSlug: "pqc-2026",
      email: "owner@official.example",
      consents,
      unaffiliatedAttestation: false,
      speakerManagementToken: link.token,
    });
    const list = async (query: string) =>
      identitiesListResponseSchema.parse(
        await (
          await request(
            `/proof/identities?${query}`,
            eventProposalProofIdentitiesSchema.parse({
              continuationToken: proof.continuationToken,
              speakerManagementToken: proof.speakerManagementToken ?? link.token,
            }),
          )
        ).json(),
      );
    const pages = await Promise.all([0, 1].map((offset) => list(`limit=1&offset=${offset}`)));
    expect(pages.flatMap((p) => p.identities.map((i) => i.id)).sort()).toEqual(ids.sort());
    expect(
      pages.every((p) => p.page.total === 2 && p.identities.length === 1 && p.identities[0].userId === link.userId),
    ).toBe(true);
    expect(await list(`userId=${otherId}`)).toMatchObject({ identities: [], page: { total: 0 } });
  });

  it("delivers a new work-mailbox proof without a stored speaker token and resumes only the original live speaker scope", async () => {
    await seedEventAndAdmin(env.DB);
    const link = await speakerLink("invited@gmail.com");
    const url = await start("invited@official.example", link.token);
    expect((await verifyEmails("invited@official.example"))[0].payload_json).not.toContain(link.token);
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.pathname).toContain("speaker");
    expect(url.pathname).not.toMatch(/\/propose\/?$/);
    const token = verifyToken(url);
    const response = await request("/proof/verify", { token });
    expect(response.status, await response.clone().text()).toBe(200);
    const ready = eventProposalProofVerifyResponseSchema.parse(await response.json());
    if (ready.status !== "ready" || !ready.speakerManagementToken || !ready.speakerManageUrl)
      throw new Error("Expected canonical speaker continuation");
    expect(
      (await getSpeakerByManageToken(env.DB, ready.speakerManagementToken, env.INTERNAL_SIGNING_SECRET!)).speaker
        .user_id,
    ).toBe(link.speaker.user_id);
    expect((await request("/proof/verify", { token })).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_emails WHERE normalized_email='invited@official.example'"),
    ).toHaveLength(0);
    await env.DB.prepare("UPDATE proposal_speakers SET manage_link_secret='revoked' WHERE id=?")
      .bind(link.speaker.id)
      .run();
    expect((await request("/proof/verify", { token })).status).toBe(403);
  });
});
