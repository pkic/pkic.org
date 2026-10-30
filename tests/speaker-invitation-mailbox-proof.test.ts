/**
 * A speaker invited at an address no one has proved yet received their link at
 * that address only. Opening the link proved that mailbox, so confirming the same
 * address again sends no second email; any other address still needs its own.
 * The proof holds only while the account stays unclaimed and the address stays its own.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifyResponseSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { prepareEmailOwnershipClaim, readEmailOwnership } from "../functions/_lib/services/email-ownership";
import { prepareEventProposalProofRedemption } from "../functions/_lib/services/event-proposal-proof-redemption";
import { isAuthorizationGuardFailure } from "../functions/_lib/db/authorization-guard";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const invited = "invited@speaker.example";

async function invitedSpeaker(invitedEmail = invited) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const proposerId = await insertUser(env.DB, "proposer@example.test");
  const userId = await insertUser(env.DB, invited);
  const proposalId = crypto.randomUUID();
  const speakerId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO session_proposals
      (id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at)
      VALUES (?, ?, ?, 'submitted', 'talk', 'Invitation proof', 'A proposal whose co-speaker confirms their invitation.', ?, datetime('now'), datetime('now'))`,
    ).bind(proposalId, eventId, proposerId, crypto.randomUUID()),
    env.DB.prepare(
      `INSERT INTO proposal_speakers
      (id,proposal_id,user_id,role,status,manage_link_secret,invite_generation,invite_expires_at,invited_email,created_at)
      VALUES (?, ?, ?, 'speaker', 'invited', ?, 0, ?, ?, ?)`,
    ).bind(
      speakerId,
      proposalId,
      userId,
      crypto.randomUUID(),
      new Date(Date.now() + 86400000).toISOString(),
      invitedEmail,
      new Date().toISOString(),
    ),
  ]);
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "speaker_manage",
    resourceId: speakerId,
  });
  return { userId, token, eventId, speakerId };
}

async function addAlias(userId: string, alias: string) {
  await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), userId, alias, alias, new Date().toISOString())
    .run();
}

function proof(path: string, body: unknown) {
  return callApi(env, `/api/v1/events/pqc-2026/proposals/proof${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function start(token: string, email: string) {
  const response = await proof("", { email, consents, unaffiliatedAttestation: true, speakerManagementToken: token });
  expect(response.status, await response.clone().text()).toBe(200);
  return eventProposalProofStartResponseSchema.parse(await response.json());
}

function verificationMails(email: string) {
  return queryAll(
    env.DB,
    "SELECT id FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=?",
    email,
  );
}

describe("speaker invitation mailbox proof", () => {
  it("continues at once when the speaker confirms the address their link was mailed to", async () => {
    const { token } = await invitedSpeaker();
    const started = await start(token, invited);
    expect(started.status).toBe("verified");
    expect(await verificationMails(invited)).toHaveLength(0);
    const verified = await proof("/verify", {
      token: started.status === "verified" ? started.token : "",
      speakerManagementToken: token,
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(eventProposalProofVerifyResponseSchema.parse(await verified.json())).toMatchObject({
      status: "ready",
      email: invited,
      applicantKind: "individual",
    });
  });

  it("still emails any other address the speaker gives", async () => {
    const { token } = await invitedSpeaker();
    expect((await start(token, "someone-else@speaker.example")).status).toBe("verification_sent");
    expect(await verificationMails("someone-else@speaker.example")).toHaveLength(1);
  });

  it("still emails the address of an account whose mailbox was proved before", async () => {
    const { userId, token } = await invitedSpeaker();
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?")
      .bind(new Date().toISOString(), userId)
      .run();
    expect((await start(token, invited)).status).toBe("verification_sent");
    expect(await verificationMails(invited)).toHaveLength(1);
  });

  it("still emails the account's primary address when the link was mailed to an alias", async () => {
    const alias = "alias@speaker.example";
    const { userId, token } = await invitedSpeaker(alias);
    await addAlias(userId, alias);
    expect((await start(token, invited)).status).toBe("verification_sent");
    expect(await verificationMails(invited)).toHaveLength(1);
    expect((await start(token, alias)).status).toBe("verified");
  });

  it("revokes the link when another person claims the alias it was mailed to", async () => {
    const alias = "alias@speaker.example";
    const { userId, token } = await invitedSpeaker(alias);
    await addAlias(userId, alias);
    const claimantId = await insertUser(env.DB, "claimant@elsewhere.example");
    await env.DB.batch(prepareEmailOwnershipClaim(env.DB, alias, claimantId, await readEmailOwnership(env.DB, alias)));
    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id=?", userId)).toHaveLength(0);

    // The link now in the claimant's mailbox no longer speaks for the invited account, under any address.
    for (const email of [invited, alias]) {
      const response = await proof("", {
        email,
        consents,
        unaffiliatedAttestation: true,
        speakerManagementToken: token,
      });
      expect(response.status).toBe(404);
    }
  });

  it("refuses an instant proof once the account was claimed before it is used", async () => {
    const { userId, token } = await invitedSpeaker();
    const started = await start(token, invited);
    expect(started.status).toBe("verified");
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?")
      .bind(new Date().toISOString(), userId)
      .run();
    const verified = await proof("/verify", {
      token: started.status === "verified" ? started.token : "",
      speakerManagementToken: token,
    });
    expect(verified.status).toBe(409);
    expect(await verified.json()).toMatchObject({ error: { code: "PROPOSAL_PERSON_CHANGED" } });
  });

  it("rechecks the unclaimed account in the batch that redeems an instant proof", async () => {
    const { userId, token, eventId, speakerId } = await invitedSpeaker();
    const started = await start(token, invited);
    const verified = await proof("/verify", {
      token: started.status === "verified" ? started.token : "",
      speakerManagementToken: token,
    });
    const ready = eventProposalProofVerifyResponseSchema.parse(await verified.json());
    const redemption = await prepareEventProposalProofRedemption(env.DB, {
      eventId,
      continuationToken: ready.status === "ready" ? ready.continuationToken : "",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      at: new Date().toISOString(),
      operation: "speaker_profile",
      speakerAuthority: token,
      speakerId,
    });
    // Someone proves the account's mailbox after the proof was read and before it commits.
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?")
      .bind(new Date().toISOString(), userId)
      .run();
    const committed = await env.DB.batch(redemption.statements).catch((error: unknown) => error);
    expect(isAuthorizationGuardFailure(committed)).toBe(true);
  });
});
