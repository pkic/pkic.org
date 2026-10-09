import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DISPOSABLE_EMAIL_REFUSED,
  ORGANIZATION_WORK_EMAIL_REQUIRED,
  eventProposalProofVerifyResponseSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
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
function proposal(continuationToken: string, unaffiliatedAttestation: boolean, proposer: Record<string, unknown>) {
  return proposalCreateSchema.parse({
    continuationToken,
    unaffiliatedAttestation,
    proposer,
    consents,
    proposal: {
      type: "Talk",
      title: "Submitted in a stated capacity",
      abstract:
        "A detailed conference proposal about submitting on behalf of an organization with a verified work address, so the program committee knows who authorized the talk and who holds its intellectual property.",
    },
  });
}
/** Proves an address on behalf of an organization through the mounted proof endpoints. */
async function proveWorkAddress(email: string, session?: string) {
  const started = await post("/proof", { email, consents }, session);
  expect(started.status, await started.clone().text()).toBe(200);
  const row = (
    await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email=? ORDER BY rowid DESC LIMIT 1",
      email,
    )
  )[0];
  const mail = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, row.payload_json);
  const token = new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get("verify");
  const verified = await post("/proof/verify", { token }, session);
  expect(verified.status, await verified.clone().text()).toBe(200);
  return eventProposalProofVerifyResponseSchema.parse(await verified.json());
}
/** A person signed in with a personal account that already took part as an individual. */
async function signedInPersonalAccount() {
  const userId = await insertUser(env.DB, "speaker@gmail.com");
  await env.DB.prepare("UPDATE users SET first_name='Personal',last_name='Speaker' WHERE id=?").bind(userId).run();
  const individual = await prepareProposalProof({
    environment: env,
    eventSlug: "pqc-2026",
    email: "speaker@gmail.com",
    consents,
    unaffiliatedAttestation: true,
  });
  const earlier = await post("", proposal(individual.continuationToken, true, { actingIdentityId: null }));
  expect(earlier.status, await earlier.clone().text()).toBe(200);
  return { userId, session: await createMemberSession(env.DB, userId, crypto.randomUUID()) };
}
async function claimedOrganization() {
  const organizationId = await insertOrganization(env.DB, "Claimed Organization");
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      "official.example",
      organizationId,
      "2026-10-05T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    )
    .run();
  return organizationId;
}
async function people() {
  return {
    users: await queryAll(env.DB, "SELECT id,normalized_email FROM users ORDER BY id"),
    addresses: await queryAll(env.DB, "SELECT id,user_id,normalized_email FROM user_emails ORDER BY id"),
    identities: await queryAll(env.DB, "SELECT id,user_id,organization_id,email_id FROM identities ORDER BY id"),
    organizations: await queryAll(env.DB, "SELECT id FROM organizations ORDER BY id"),
  };
}

describe("proposal contact capacity and identity", () => {
  it("refuses a personal address on behalf of an organization before sending anything", async () => {
    await seedEventAndAdmin(env.DB);
    const personal = await post("/proof", { email: "speaker@gmail.com", consents });
    expect(personal.status).toBe(400);
    expect(JSON.stringify(await personal.json())).toContain(ORGANIZATION_WORK_EMAIL_REQUIRED);
    const disposable = await post("/proof", {
      email: "speaker@mailinator.com",
      consents,
      unaffiliatedAttestation: true,
    });
    expect(JSON.stringify(await disposable.json())).toContain(DISPOSABLE_EMAIL_REFUSED);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    const individual = await post("/proof", { email: "speaker@gmail.com", consents, unaffiliatedAttestation: true });
    expect(individual.status, await individual.clone().text()).toBe(200);
  });

  it("adds the verified work address and its domain's organization to the signed-in personal account", async () => {
    await seedEventAndAdmin(env.DB);
    const organizationId = await claimedOrganization();
    const { userId, session } = await signedInPersonalAccount();
    const before = await people();
    const proof = await proveWorkAddress("speaker@official.example", session);
    if (proof.status !== "ready") throw new Error(`Expected a ready proof, got ${proof.status}`);
    expect(proof.organization).toEqual({ id: organizationId, name: "Claimed Organization" });
    const submitted = await post("", proposal(proof.continuationToken, false, {}), session);
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    const after = await people();
    expect(after.users).toEqual(before.users);
    expect(after.organizations).toEqual(before.organizations);
    const [address] = after.addresses;
    expect(after.addresses).toEqual([
      { id: address.id, user_id: userId, normalized_email: "speaker@official.example" },
    ]);
    const [identity] = after.identities;
    expect(after.identities).toEqual([
      { id: identity.id, user_id: userId, organization_id: organizationId, email_id: address.id },
    ]);
    const submittedAs = await queryAll(
      env.DB,
      "SELECT proposal.proposer_user_id,speaker.acting_identity_id FROM session_proposals proposal JOIN proposal_speakers speaker ON speaker.proposal_id=proposal.id AND speaker.user_id=proposal.proposer_user_id ORDER BY speaker.acting_identity_id IS NOT NULL",
    );
    expect(submittedAs).toEqual([
      { proposer_user_id: userId, acting_identity_id: null },
      { proposer_user_id: userId, acting_identity_id: identity.id },
    ]);
  });

  it("asks a signed-in person to sign in with a work address another account owns and links nothing", async () => {
    await seedEventAndAdmin(env.DB);
    await claimedOrganization();
    const owner = await insertUser(env.DB, "speaker@official.example");
    const { session } = await signedInPersonalAccount();
    const before = await people();
    expect(await proveWorkAddress("speaker@official.example", session)).toEqual({
      status: "sign_in_required",
      email: "speaker@official.example",
    });
    expect(await people()).toEqual(before);
    expect(before.users).toContainEqual({ id: owner, normalized_email: "speaker@official.example" });
  });

  it("lets a guest's verified work address own the proposal and name an unknown organization", async () => {
    await seedEventAndAdmin(env.DB);
    const proof = await proveWorkAddress("guest@new-domain.example");
    if (proof.status !== "ready") throw new Error(`Expected a ready proof, got ${proof.status}`);
    expect(proof.organization).toBeNull();
    const submitted = await post(
      "",
      proposal(proof.continuationToken, false, {
        firstName: "Guest",
        lastName: "Speaker",
        organizationName: "New Domain Organization",
      }),
    );
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        `SELECT person.normalized_email,organization.name,identity.verified_email_domain,
                speaker.acting_identity_id=identity.id AS submitted_as_identity
           FROM session_proposals proposal
           JOIN users person ON person.id=proposal.proposer_user_id
           JOIN proposal_speakers speaker ON speaker.proposal_id=proposal.id AND speaker.user_id=person.id
           JOIN identities identity ON identity.user_id=person.id
           JOIN organizations organization ON organization.id=identity.organization_id`,
      ),
    ).toEqual([
      {
        normalized_email: "guest@new-domain.example",
        name: "New Domain Organization",
        verified_email_domain: "new-domain.example",
        submitted_as_identity: 1,
      },
    ]);
  });
});
