import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_EMAIL_REFUSED, WORK_EMAIL_STEER } from "../assets/shared/email-first-copy";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization } from "./helpers/membership";
import { signInProposer } from "./helpers/proposal-proof";
import { resetDb } from "./helpers/reset-db";
import { withIndependentCapacity } from "./helpers/independent-capacity";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
/** A proposal in the capacity its chosen identity implies: an organization identity, or `null` as an individual. */
function proposal(actingIdentityId: string | null, capacity: { unaffiliatedAttestation?: boolean } = {}) {
  return proposalCreateSchema.parse({
    ...withIndependentCapacity({ unaffiliatedAttestation: actingIdentityId === null, ...capacity }),
    proposer: { actingIdentityId },
    consents,
    proposal: {
      type: "Talk",
      title: "Submitted in a stated capacity",
      abstract:
        "A detailed conference proposal about submitting on behalf of an organization with a verified work address, so the program committee knows who authorized the talk and who holds its intellectual property.",
    },
  });
}
/** A person signed in with a personal account, and an organization they represent through `workEmail`. */
async function personalAccount(workEmail: string | null) {
  await seedEventAndAdmin(env.DB);
  const person = await signInProposer({
    environment: env,
    email: "speaker@gmail.com",
    firstName: "Personal",
    lastName: "Speaker",
  });
  const organizationId = await insertOrganization(env.DB, "Claimed Organization");
  const emailId = workEmail ? crypto.randomUUID() : null;
  if (workEmail)
    await env.DB.prepare(
      "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES (?1,?2,?3,?3,?4,'magic_link',?4)",
    )
      .bind(emailId, person.userId, workEmail, "2026-10-05T00:00:00.000Z")
      .run();
  const identity = await buildCreateIdentityStatement(env.DB, {
    userId: person.userId,
    organizationId,
    emailId,
    source: "staff",
    startImmediately: true,
    jobTitle: "Security engineer",
  });
  await env.DB.batch([identity.statement]);
  return { ...person, organizationId, emailId, identityId: identity.identityId };
}
async function stored() {
  return {
    users: await queryAll(env.DB, "SELECT id,normalized_email FROM users ORDER BY id"),
    addresses: await queryAll(env.DB, "SELECT id,user_id,normalized_email FROM user_emails ORDER BY id"),
    identities: await queryAll(env.DB, "SELECT id,user_id,organization_id,email_id FROM identities ORDER BY id"),
    organizations: await queryAll(env.DB, "SELECT id FROM organizations ORDER BY id"),
    proposals: await queryAll(env.DB, "SELECT id FROM session_proposals ORDER BY id"),
    consents: await queryAll(env.DB, "SELECT id FROM consent_acceptances ORDER BY id"),
  };
}

describe("proposal contact capacity and identity", () => {
  it("refuses a speaker's personal address on behalf of an organization before sending anything", async () => {
    await seedEventAndAdmin(env.DB);
    const personal = await post("/proof", { email: "speaker@gmail.com", consents });
    expect(personal.status).toBe(400);
    expect(JSON.stringify(await personal.json())).toContain(WORK_EMAIL_STEER);
    const disposable = await post("/proof", {
      email: "speaker@mailinator.com",
      consents,
      unaffiliatedAttestation: true,
    });
    expect(disposable.status).toBe(400);
    expect(JSON.stringify(await disposable.json())).toContain(DISPOSABLE_EMAIL_REFUSED);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("refuses an organization identity that only carries the person's personal address", async () => {
    const person = await personalAccount(null);
    const before = await stored();
    const response = await post("", proposal(person.identityId), person.headers);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "PROPOSAL_OFFICIAL_EMAIL_REQUIRED" } });
    expect(await stored()).toEqual(before);
  });

  it("refuses an organization identity whose work address is no longer verified", async () => {
    const person = await personalAccount("speaker@official.example");
    await env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(person.emailId).run();
    const before = await stored();
    const response = await post("", proposal(person.identityId), person.headers);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await stored()).toEqual(before);
  });

  it("refuses a capacity that contradicts the chosen identity", async () => {
    const person = await personalAccount("speaker@official.example");
    const before = await stored();
    for (const body of [
      proposal(person.identityId, { unaffiliatedAttestation: true }),
      proposal(null, { unaffiliatedAttestation: false }),
    ]) {
      const response = await post("", body, person.headers);
      expect(response.status, await response.clone().text()).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "PROPOSAL_QUALIFICATION_CONFLICT" } });
    }
    expect(await stored()).toEqual(before);
  });

  it("submits a personal account's proposals as its verified work address's organization or as an individual", async () => {
    const person = await personalAccount("speaker@official.example");
    const before = await stored();
    for (const actingIdentityId of [null, person.identityId]) {
      const submitted = await post("", proposal(actingIdentityId), person.headers);
      expect(submitted.status, await submitted.clone().text()).toBe(200);
    }
    const after = await stored();
    expect(after.users).toEqual(before.users);
    expect(after.addresses).toEqual(before.addresses);
    expect(after.organizations).toEqual(before.organizations);
    // The organization identity the work address carries, beside the individual one the personal proposal speaks as.
    expect(after.identities.filter((row) => row.organization_id !== null)).toEqual([
      {
        id: person.identityId,
        user_id: person.userId,
        organization_id: person.organizationId,
        email_id: person.emailId,
      },
    ]);
    expect(after.identities.filter((row) => row.organization_id === null)).toEqual([
      expect.objectContaining({ user_id: person.userId, email_id: null }),
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT proposal.proposer_user_id,speaker.acting_identity_id FROM session_proposals proposal JOIN proposal_speakers speaker ON speaker.proposal_id=proposal.id AND speaker.user_id=proposal.proposer_user_id ORDER BY speaker.acting_identity_id IS NOT NULL",
      ),
    ).toEqual([
      { proposer_user_id: person.userId, acting_identity_id: null },
      { proposer_user_id: person.userId, acting_identity_id: person.identityId },
    ]);
  });
});
