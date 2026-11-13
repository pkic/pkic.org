import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { insertOrganization, insertUser } from "./helpers/membership";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
import { createMemberSession } from "./helpers/auth";
import { prepareAccountIdentityStatement } from "../functions/_lib/services/users";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { registrationCreateSchema, registrationSubmissionResponseSchema } from "../assets/shared/schemas/registration";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

const API = "/api/v1/events/pqc-2026/registrations";
const consents = [
  { termKey: "privacy-policy", version: "v1" },
  { termKey: "code-of-conduct", version: "v1" },
];

let sequence = 0;

function registration(email: string, extra: Record<string, unknown> = {}) {
  return registrationCreateSchema.parse({
    firstName: "Casey",
    lastName: "Attendee",
    email,
    unaffiliatedAttestation: false,
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
    consents,
    ...extra,
  });
}

function submit(body: unknown, session?: string, environment = env) {
  return callApi(environment, API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": `2001:db8::${(++sequence).toString(16)}`,
      ...(session ? { authorization: `Bearer ${session}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** A person with an account identity and a session, as the sign-in card leaves them. */
async function signedIn(email: string, names: { firstName: string | null; lastName: string | null }) {
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET first_name=?,last_name=? WHERE id=?")
    .bind(names.firstName, names.lastName, userId)
    .run();
  await prepareAccountIdentityStatement(env.DB, userId, new Date().toISOString()).run();
  const session = await createMemberSession(env.DB, userId, `registration-session-${++sequence}`);
  return { userId, session };
}

describe("registration continues with the signed-in session", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare(`INSERT INTO event_days(id,event_id,day_date,created_at,updated_at)
      SELECT 'session-day',id,'2026-12-01','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z' FROM events WHERE slug='pqc-2026'`).run();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("registers a signed-in person with their own address at once", async () => {
    const { session } = await signedIn("signed.in@gmail.com", { firstName: "Casey", lastName: "Fixture" });
    const response = await submit(registration("signed.in@gmail.com", { unaffiliatedAttestation: true }), session);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationSubmissionResponseSchema.parse(await response.json()).status).toBe("registered");
  });

  it.each([
    [null, "Fixture"],
    ["Casey", null],
    ["   ", "Fixture"],
    ["casey@example.test", "Fixture"],
    ["Casey", "casey@example.test"],
  ])("requires the signed-in owner to correct saved names (%s, %s)", async (firstName, lastName) => {
    const email = `name-correction-${++sequence}@gmail.com`;
    const { userId, session } = await signedIn(email, { firstName, lastName });
    const body = registration(email, { unaffiliatedAttestation: true });
    const refused = await submit(body, session);
    expect(refused.status, await refused.clone().text()).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "REGISTRATION_PROFILE_INCOMPLETE" } });
    expect(await queryAll(env.DB, "SELECT id FROM registrations WHERE user_id=?", userId)).toEqual([]);
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", userId)).toEqual([
      { first_name: firstName, last_name: lastName },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='registration_confirmed'")).toEqual(
      [],
    );

    await env.DB.prepare("UPDATE users SET first_name='Zoë',last_name='李' WHERE id=?").bind(userId).run();
    const accepted = await submit(body, session);
    expect(accepted.status, await accepted.clone().text()).toBe(200);
  });

  it("rolls back registration when the saved name changes after validation", async () => {
    const email = "name-race@gmail.com";
    const { userId, session } = await signedIn(email, { firstName: "Casey", lastName: "Fixture" });
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO authorization_guards") && sql.includes("first_name IS ?"),
      () => env.DB.prepare("UPDATE users SET last_name=NULL WHERE id=?").bind(userId).run(),
    );
    const response = await submit(registration(email, { unaffiliatedAttestation: true }), session, {
      ...env,
      DB: raced,
    } as typeof env);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await queryAll(env.DB, "SELECT id FROM registrations WHERE user_id=?", userId)).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='registration_confirmed'")).toEqual(
      [],
    );
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='registration_created'")).toEqual([]);
  });

  it("requires a signed-in registrant using a work address to choose an organization identity", async () => {
    const email = "signed-in@new-org.example";
    const { userId, session } = await signedIn(email, { firstName: "Casey", lastName: "Fixture" });
    const send = (identityId?: string) => submit(registration(email, identityId ? { identityId } : {}), session);
    const refused = await send();
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "REGISTRATION_REPRESENTATION_REQUIRED" } });
    const organizationId = await insertOrganization(env.DB, "Signed-in organization");
    const identity = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId,
      source: "account",
      startImmediately: true,
    });
    await identity.statement.run();
    const accepted = await send(identity.identityId);
    expect(accepted.status, await accepted.clone().text()).toBe(200);
  });

  it("refuses an identity chosen by a session that does not own the submitted address", async () => {
    const { session } = await signedIn("owner@gmail.com", { firstName: "Casey", lastName: "Fixture" });
    const response = await submit(
      registration("someone.else@gmail.com", { unaffiliatedAttestation: true, identityId: crypto.randomUUID() }),
      session,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "REGISTRATION_SESSION_EMAIL_REQUIRED" } });
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
  });

  it("waits for email confirmation when a registration arrives without a session", async () => {
    const response = await submit(registration("casey@new-org.example"));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationSubmissionResponseSchema.parse(await response.json()).status).toBe("pending_email_confirmation");
  });

  it("no longer accepts a mailbox proof in place of a session", async () => {
    const start = await callApi(env, `${API}/proof`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "casey@gmail.com", unaffiliatedAttestation: true }),
    });
    expect(start.status).toBe(404);
    const carried = await submit({
      ...registration("casey@gmail.com", { unaffiliatedAttestation: true }),
      emailProof: "synthetic-mailbox-proof-01234567890123456789",
    });
    expect(carried.status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
  });

  it("refuses registration before event days are scheduled", async () => {
    await env.DB.prepare("DELETE FROM event_days WHERE id='session-day'").run();
    const response = await submit(registration("unscheduled@new-org.example"));
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "EVENT_DAYS_NOT_SCHEDULED" } });
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
  });
});
