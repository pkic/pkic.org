import {
  registrationProofPersonPatchSchema,
  registrationProofPersonPatchResponseSchema,
} from "../assets/shared/schemas/registration-email-proof";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication } from "./helpers/member-applications";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { insertOrganization, insertUser } from "./helpers/membership";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
import { createMemberSession } from "./helpers/auth";
import { prepareAccountIdentityStatement } from "../functions/_lib/services/users";
import {
  registrationEmailProofStartSchema,
  registrationEmailProofVerifyResponseSchema,
} from "../assets/shared/schemas/registration-email-proof";
import { registrationCreateSchema, registrationSubmissionResponseSchema } from "../assets/shared/schemas/registration";

const API = "/api/v1/events/pqc-2026/registrations";
const consents = [
  { termKey: "privacy-policy", version: "v1" },
  { termKey: "code-of-conduct", version: "v1" },
];

const post = (path: string, body: unknown) =>
  callApi(
    env,
    `${API}${path}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    path === "/proof/verify" ? { maxRoundTrips: 1 } : undefined,
  );

/** Starts verification and returns the link the email carries. */
async function emailedLink(email: string, body: Record<string, unknown> = {}): Promise<URL> {
  const response = await post("/proof", registrationEmailProofStartSchema.parse({ email, ...body }));
  expect(response.status, await response.clone().text()).toBe(200);
  const [mail] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_email_verify' AND recipient_email = ?",
    [email],
  );
  return new URL(
    (await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, mail.payload_json)).verificationUrl,
  );
}

const tokenOf = (link: URL) => new URLSearchParams(link.hash.slice(1)).get("verify")!;

function registration(email: string, emailProof: string | undefined, extra: Record<string, unknown> = {}) {
  return registrationCreateSchema.parse({
    firstName: "Casey",
    lastName: "Attendee",
    email,
    unaffiliatedAttestation: false,
    attendanceType: "virtual",
    consents,
    emailProof,
    ...extra,
  });
}

describe("registration verifies the email address first", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
    await seedEventAndAdmin(env.DB);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("emails a link back to the registration form and stores nothing until the person registers", async () => {
    const link = await emailedLink("casey@new-org.example", { entry: { referralCode: "ABCDEF12" } });
    expect(link.pathname).toMatch(/\/register\/$/);
    expect(link.searchParams.get("ref")).toBe("ABCDEF12");
    expect(tokenOf(link)).toBeTruthy();
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = 'casey@new-org.example'")).toEqual([]);
  });

  it("returns the verified address, a known person's names and whether the domain needs an organization", async () => {
    await insertUser(env.DB, "known@new-org.example");
    const response = await post("/proof/verify", { token: tokenOf(await emailedLink("known@new-org.example")) });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationEmailProofVerifyResponseSchema.parse(await response.json())).toMatchObject({
      email: "known@new-org.example",
      unaffiliatedAttestation: false,
      person: { firstName: "Test", lastName: null },
      asksOrganization: true,
    });

    const individual = await post("/proof/verify", {
      token: tokenOf(await emailedLink("someone@gmail.com", { unaffiliatedAttestation: true })),
    });
    expect(registrationEmailProofVerifyResponseSchema.parse(await individual.json())).toMatchObject({
      unaffiliatedAttestation: true,
      person: null,
      asksOrganization: false,
    });
  });

  it("lets proof reclaim a seconds-old unverified alias without adopting its requesting account", async () => {
    const email = "casey@claimed.example";
    const attacker = await insertUser(env.DB, "attacker@other.example");
    const at = new Date().toISOString();
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), attacker, email, email, at)
      .run();
    const proof = tokenOf(await emailedLink(email));
    const preview = await post("/proof/verify", { token: proof });
    expect(registrationEmailProofVerifyResponseSchema.parse(await preview.json()).person).toBeNull();
    const response = await post("", registration(email, proof));
    expect(response.status, await response.clone().text()).toBe(200);
    const [owner] = await queryAll<{ id: string; email_verified_at: string }>(
      env.DB,
      "SELECT id,email_verified_at FROM users WHERE normalized_email=?",
      [email],
    );
    expect(owner.id).not.toBe(attacker);
    expect(owner.email_verified_at).toMatch(/Z$/);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE id=?", [attacker])).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id=? AND normalized_email=?", [attacker, email]),
    ).toEqual([]);
  });

  it("recovers an unverified primary account without inheriting its passkey or browser session", async () => {
    const email = "casey@unverified.example";
    const userId = await insertUser(env.DB, email);
    const at = new Date().toISOString();
    await env.DB.batch([
      prepareAccountIdentityStatement(env.DB, userId, at),
      env.DB.prepare(
        "INSERT INTO passkey_credentials(id,user_id,credential_id,public_key,created_at) VALUES(?,?,?,?,?)",
      ).bind(crypto.randomUUID(), userId, "untrusted-old-passkey", "untrusted-key", at),
    ]);
    await createMemberSession(env.DB, userId, "untrusted-old-session");
    const response = await post("", registration(email, tokenOf(await emailedLink(email))));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM passkey_credentials WHERE user_id=? AND revoked_at IS NULL", [userId]),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL", [userId])).toEqual(
      [],
    );
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [userId])).toHaveLength(1);
  });

  it("preserves an already verified account under its owned address when its unverified primary is claimed", async () => {
    const email = "casey@unproved-primary.example";
    const established = await insertUser(env.DB, email);
    const at = new Date().toISOString();
    await env.DB.batch([
      prepareAccountIdentityStatement(env.DB, established, at),
      env.DB.prepare(
        "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES(?,?,?,?,?,'magic_link',?)",
      ).bind(crypto.randomUUID(), established, "owner@established.example", "owner@established.example", at, at),
    ]);
    const response = await post("", registration(email, tokenOf(await emailedLink(email))));
    expect(response.status, await response.clone().text()).toBe(200);
    const [original] = await queryAll<{ normalized_email: string }>(
      env.DB,
      "SELECT normalized_email FROM users WHERE id=?",
      [established],
    );
    expect(original.normalized_email).toBe("owner@established.example");
    const [newOwner] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email]);
    expect(newOwner.id).not.toBe(established);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [established])).toHaveLength(1);
  });

  it("registers a verified address at once, verifies it, and links the organization the form named", async () => {
    const email = "casey@unknown-org.example";
    const response = await post(
      "",
      registration(email, tokenOf(await emailedLink(email)), {
        organization: { name: "Unknown Org Labs", jobTitle: "Engineer" },
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(result).toMatchObject({ status: "registered", organizationOutcome: "linked" });
    expect(result.manageUrl).toBeTruthy();
    const [person] = await queryAll<{ email_verified_at: string | null }>(
      env.DB,
      "SELECT email_verified_at FROM users WHERE normalized_email = ?",
      [email],
    );
    expect(person.email_verified_at).toMatch(/Z$/);
    const templates = await queryAll<{ template_key: string }>(
      env.DB,
      "SELECT template_key FROM email_outbox WHERE recipient_email = ? ORDER BY rowid",
      [email],
    );
    expect(templates.map((row) => row.template_key)).toEqual(["registration_email_verify", "registration_confirmed"]);
    expect(
      await queryAll(
        env.DB,
        `SELECT organization.name FROM identities identity
           JOIN users person ON person.id = identity.user_id
           JOIN organizations organization ON organization.id = identity.organization_id
          WHERE person.normalized_email = ?`,
        [email],
      ),
    ).toEqual([{ name: "Unknown Org Labs" }]);
  });

  it("joins a verified work address to the organization its domain belongs to", async () => {
    const organizationId = await insertOrganization(env.DB, "Open Domain Co");
    await env.DB.prepare(
      `INSERT INTO organization_domain_claims (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'open-domain.test', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();
    const email = "casey@open-domain.test";
    const verified = await post("/proof/verify", { token: tokenOf(await emailedLink(email)) });
    expect(registrationEmailProofVerifyResponseSchema.parse(await verified.json())).toMatchObject({
      asksOrganization: true,
      affiliation: { organization: { id: organizationId, name: "Open Domain Co" } },
    });
    const response = await post("", registration(email, tokenOf(await emailedLink(email))));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationSubmissionResponseSchema.parse(await response.json()).status).toBe("registered");
    expect(
      await queryAll(
        env.DB,
        `SELECT organization.name FROM identities identity
           JOIN users person ON person.id = identity.user_id
           JOIN organizations organization ON organization.id = identity.organization_id
          WHERE person.normalized_email = ?`,
        [email],
      ),
    ).toEqual([{ name: "Open Domain Co" }]);
  });

  it("refuses a proof for another address or capacity, and a forged one", async () => {
    const token = tokenOf(await emailedLink("casey@new-org.example"));
    const other = await post("", registration("someone@new-org.example", token));
    expect(other.status).toBe(422);
    const capacity = await post("", registration("casey@new-org.example", token, { unaffiliatedAttestation: true }));
    expect(capacity.status).toBe(422);
    const forged = await post("", registration("casey@new-org.example", `${token.slice(0, -4)}AAAA`));
    expect(forged.status).toBe(404);
    const verify = await post("/proof/verify", { token: `${token.slice(0, -4)}AAAA` });
    expect(verify.status).toBe(404);
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
  });

  it("registers a signed-in person with their own address without a link", async () => {
    const userId = await insertUser(env.DB, "signed-in@new-org.example");
    await prepareAccountIdentityStatement(env.DB, userId, new Date().toISOString()).run();
    const session = await createMemberSession(env.DB, userId, "registration-session-token");
    const response = await callApi(env, API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
      body: JSON.stringify(registration("signed-in@new-org.example", undefined)),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationSubmissionResponseSchema.parse(await response.json()).status).toBe("registered");
  });

  it("still waits for email confirmation when a registration arrives without proof", async () => {
    const response = await post("", registration("casey@new-org.example", undefined));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationSubmissionResponseSchema.parse(await response.json()).status).toBe("pending_email_confirmation");
  });
  it.each([false, true])("registers a reserved work domain with affiliation review; stale claim: %s", async (stale) => {
    const email = "attendee@reserved-work.example";
    const applicationId = await seedMemberApplication({
      applicantEmail: "applicant@reserved-work.example",
      organizationDomain: "reserved-work.example",
    });
    const proof = tokenOf(await emailedLink(email));
    const verified = await post("/proof/verify", { token: proof });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(registrationEmailProofVerifyResponseSchema.parse(await verified.json()).affiliation).toMatchObject({
      organization: null,
      organizations: [],
      reviewRequired: true,
    });
    const prepared = await post("/proof/verify", {
      token: proof,
      affiliation: { organizationId: null, organizationName: "Pending Work Organization", jobTitle: "Engineer" },
    });
    expect(prepared.status, await prepared.clone().text()).toBe(200);
    const contextToken = registrationEmailProofVerifyResponseSchema.parse(await prepared.json()).affiliation!
      .contextToken!;
    if (stale)
      await env.DB.prepare("DELETE FROM organization_domain_claims WHERE application_id=?").bind(applicationId).run();
    const response = await post(
      "",
      registration(email, proof, {
        organization: { name: "Pending Work Organization", jobTitle: "Engineer", contextToken },
      }),
    );
    if (stale) {
      expect(response.status).toBe(409);
      expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM affiliation_reviews")).toEqual([]);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='registration_confirmation'"),
      ).toEqual([]);
      return;
    }
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(result).toMatchObject({ status: "registered", organizationOutcome: "review_required" });
    const [stored] = await queryAll<{ registration_identity_id: string | null; email_verified_at: string | null }>(
      env.DB,
      "SELECT registration.registration_identity_id,person.email_verified_at FROM registrations registration JOIN users person ON person.id=registration.user_id WHERE registration.id=?",
      [result.registrationId],
    );
    expect(stored.registration_identity_id).toBeNull();
    expect(stored.email_verified_at).toBeTruthy();
    expect(await queryAll(env.DB, "SELECT organization_name,job_title,source_id FROM affiliation_reviews")).toEqual([
      { organization_name: "Pending Work Organization", job_title: "Engineer", source_id: result.registrationId },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id IS NOT NULL")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM organizations")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT application_id,organization_id FROM organization_domain_claims")).toEqual([
      { application_id: applicationId, organization_id: null },
    ]);
  });

  it("shows the domain default but honors another organization through the same affiliation flow", async () => {
    const original = await insertOrganization(env.DB, "Default Domain Organization");
    await env.DB.prepare(
      "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES(?,'shared-choice.test',?,?,?)",
    )
      .bind(crypto.randomUUID(), original, new Date().toISOString(), new Date().toISOString())
      .run();
    const email = "first@shared-choice.test";
    const proof = tokenOf(await emailedLink(email));
    const preview = registrationEmailProofVerifyResponseSchema.parse(
      await (await post("/proof/verify", { token: proof })).json(),
    );
    expect(preview.affiliation?.organization).toEqual({ id: original, name: "Default Domain Organization" });
    const prepared = await post("/proof/verify", {
      token: proof,
      affiliation: {
        organizationId: null,
        organizationName: "Chosen Domain Organization",
        jobTitle: "Engineer",
        domain: "shared-choice.test",
      },
    });
    expect(prepared.status, await prepared.clone().text()).toBe(200);
    const contextToken = registrationEmailProofVerifyResponseSchema.parse(await prepared.json()).affiliation!
      .contextToken!;
    const result = await post(
      "",
      registration(email, proof, {
        organization: { name: "Chosen Domain Organization", jobTitle: "Engineer", contextToken },
      }),
    );
    expect(result.status, await result.clone().text()).toBe(200);
    const [stored] = await queryAll<{ registration_identity_id: string; organization_id: string; name: string }>(
      env.DB,
      `SELECT registration.registration_identity_id,identity.organization_id,organization.name FROM registrations registration JOIN users person ON person.id=registration.user_id JOIN identities identity ON identity.id=registration.registration_identity_id JOIN organizations organization ON organization.id=identity.organization_id WHERE person.normalized_email=?`,
      [email],
    );
    expect(stored.name).toBe("Chosen Domain Organization");
    expect(stored.organization_id).not.toBe(original);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM identities WHERE organization_id=? AND user_id=(SELECT id FROM users WHERE normalized_email=?)",
        [original, email],
      ),
    ).toEqual([]);
    const secondEmail = "second@shared-choice.test";
    const secondProof = tokenOf(await emailedLink(secondEmail));
    const choices = registrationEmailProofVerifyResponseSchema.parse(
      await (await post("/proof/verify", { token: secondProof })).json(),
    ).affiliation!;
    expect(choices.organization?.id).toBe(original);
    expect(choices.organizations.map((x) => x.name)).toContain("Chosen Domain Organization");
    const selected = registrationEmailProofVerifyResponseSchema.parse(
      await (
        await post("/proof/verify", {
          token: secondProof,
          affiliation: { organizationId: stored.organization_id, jobTitle: "Researcher", domain: "shared-choice.test" },
        })
      ).json(),
    ).affiliation!;
    const second = await post(
      "",
      registration(secondEmail, secondProof, {
        organization: {
          name: "Chosen Domain Organization",
          jobTitle: "Researcher",
          contextToken: selected.contextToken,
        },
      }),
    );
    expect(second.status, await second.clone().text()).toBe(200);
  });
  it("does not let a mailbox proof enumerate unrelated organizations or reuse another address's prepared choice", async () => {
    const email = "proof@private-choice.test";
    const proof = tokenOf(await emailedLink(email));
    expect(
      (
        await post("/proof/verify", {
          token: proof,
          affiliation: { organizationId: crypto.randomUUID(), jobTitle: "Engineer" },
        })
      ).status,
    ).toBe(422);
    const prepared = registrationEmailProofVerifyResponseSchema.parse(
      await (
        await post("/proof/verify", {
          token: proof,
          affiliation: { organizationId: null, organizationName: "Private Choice", jobTitle: "Engineer" },
        })
      ).json(),
    ).affiliation!;
    const missing = await post(
      "",
      registration(email, proof, {
        organization: { name: "Private Choice", jobTitle: "Engineer", organizationId: null },
      }),
    );
    expect(missing.status).toBe(409);
    const mismatch = await post(
      "",
      registration(email, proof, {
        organization: {
          name: "Different Choice",
          jobTitle: "Engineer",
          organizationId: null,
          contextToken: prepared.contextToken,
        },
      }),
    );
    expect(mismatch.status).toBe(409);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toEqual([]);
    const other = "other@private-choice.test";
    const otherProof = tokenOf(await emailedLink(other));
    const result = await post(
      "",
      registration(other, otherProof, {
        organization: { name: "Private Choice", jobTitle: "Engineer", contextToken: prepared.contextToken },
      }),
    );
    expect(result.status).toBe(409);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [other])).toEqual([]);
  });
});

describe("verified registration personal-name corrections", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
    await seedEventAndAdmin(env.DB);
  });
  afterEach(() => vi.unstubAllGlobals());
  const patchNames = (body: unknown, slug = "pqc-2026") =>
    callApi(
      env,
      `/api/v1/events/${slug}/registrations/proof/person`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { maxRoundTrips: 1 },
    );
  it("corrects legacy data on the canonical user in one complete request batch", async () => {
    const userId = await insertUser(env.DB, "correction@names.example");
    await env.DB.prepare("UPDATE users SET first_name=?,last_name=? WHERE id=?").bind("ZoÃ«", "Example", userId).run();
    const token = tokenOf(await emailedLink("correction@names.example"));
    const response = await patchNames(
      registrationProofPersonPatchSchema.parse({ userId, token, firstName: "Zoë", lastName: "Cafe\u0301" }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationProofPersonPatchResponseSchema.parse(await response.json()).person).toEqual({
      userId,
      firstName: "Zoë",
      lastName: "Café",
    });
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", userId)).toEqual([
      { first_name: "Zoë", last_name: "Café" },
    ]);
    expect(await queryAll(env.DB, "SELECT action FROM audit_log WHERE entity_id=?", userId)).toContainEqual({
      action: "user_profile_updated",
    });
  });
  it("rejects an expired proof before any profile or audit write", async () => {
    const userId = await insertUser(env.DB, "expired@names.example");
    const token = tokenOf(await emailedLink("expired@names.example"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 365 * 86400 * 1000);
    try {
      expect((await patchNames({ userId, token, firstName: "Wrong" })).status).toBe(410);
    } finally {
      clock.mockRestore();
    }
    expect(await queryAll(env.DB, "SELECT first_name FROM users WHERE id=?", userId)).toEqual([{ first_name: "Test" }]);
    expect(await queryAll(env.DB, "SELECT action FROM audit_log WHERE action='user_profile_updated'")).toEqual([]);
  });
  it("refuses a different user, another event, stale ownership, and an invalid proof without changing names", async () => {
    const userId = await insertUser(env.DB, "owner@names.example");
    const otherId = await insertUser(env.DB, "other@names.example");
    const token = tokenOf(await emailedLink("owner@names.example"));
    expect((await patchNames({ userId: otherId, token, firstName: "Wrong" })).status).toBe(403);
    expect((await patchNames({ userId, token, firstName: "Wrong" }, "another-event")).status).toBe(403);
    expect(
      (await patchNames({ userId, token: "invalid-proof-012345678901234567890123456789", firstName: "Wrong" })).status,
    ).toBe(404);
    await env.DB.prepare("UPDATE users SET email=?,normalized_email=? WHERE id=?")
      .bind("moved@names.example", "moved@names.example", userId)
      .run();
    expect((await patchNames({ userId, token, firstName: "Wrong" })).status).toBe(403);
    expect(await queryAll(env.DB, "SELECT first_name FROM users WHERE id IN(?,?)", userId, otherId)).toEqual([
      { first_name: "Test" },
      { first_name: "Test" },
    ]);
    expect(await queryAll(env.DB, "SELECT action FROM audit_log WHERE action='user_profile_updated'")).toEqual([]);
  });
});
