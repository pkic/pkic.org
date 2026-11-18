import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { insertOrganization } from "./helpers/membership";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
import { signInRegistrant } from "./helpers/auth";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { registrationCreateSchema, registrationSubmissionResponseSchema } from "../assets/shared/schemas/registration";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { createPendingRegistration } from "./helpers/registration-confirmation";
import { createInvite } from "../functions/_lib/services/invites";
import { prepareAccountPolicyAcceptanceStatements } from "../functions/_lib/services/account-policies";
import { ACCOUNT_POLICIES } from "../assets/shared/account-policies";

const API = "/api/v1/events/pqc-2026/registrations";
const consents = [
  { termKey: "privacy-policy", version: "v1" },
  { termKey: "code-of-conduct", version: "v1" },
];

let sequence = 0;

function registration(email: string, extra: Record<string, unknown> = {}) {
  return registrationCreateSchema.parse({
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
    const { session } = await signInRegistrant(env.DB, "signed.in@gmail.com", {
      firstName: "Casey",
      lastName: "Fixture",
    });
    const response = await submit(registration("signed.in@gmail.com", { unaffiliatedAttestation: true }), session);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationSubmissionResponseSchema.parse(await response.json()).status).toBe("registered");
  });

  it.each([
    ["accepts", null, { status: "accepted" }, true],
    ["leaves an expired", "2020-01-01T00:00:00.000Z", { status: "sent" }, false],
  ] as const)(
    "%s invitation sent to the signed-in address and records the confirmed registration",
    async (_case, expiresAt, invite, linked) => {
      const email = "invited.attendee@gmail.com";
      const { userId, session } = await signInRegistrant(env.DB, email, { firstName: "Casey", lastName: "Fixture" });
      const inviteId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO invites (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
         SELECT ?, id, ?, 'attendee', ?, 'sent', 'direct', ?, '2026-01-01T00:00:00.000Z' FROM events WHERE slug='pqc-2026'`,
      )
        .bind(inviteId, email, `sent-${inviteId}`, expiresAt)
        .run();
      const response = await submit(registration(email, { unaffiliatedAttestation: true }), session);
      expect(response.status, await response.clone().text()).toBe(200);
      const { registrationId } = registrationSubmissionResponseSchema.parse(await response.json());
      expect(await queryAll(env.DB, "SELECT invite_id FROM registrations WHERE id=?", registrationId)).toEqual([
        { invite_id: linked ? inviteId : null },
      ]);
      expect(await queryAll(env.DB, "SELECT status FROM invites WHERE id=?", inviteId)).toEqual([invite]);
      expect(
        await queryAll(
          env.DB,
          "SELECT action_type FROM engagement_events WHERE user_id=? AND subject_ref=? ORDER BY action_type",
          userId,
          registrationId,
        ),
      ).toEqual([{ action_type: "registration_confirmed" }, { action_type: "registration_created" }]);
    },
  );

  it("admits an invite-only registration through the invitation sent to the signed-in address, without its link", async () => {
    await env.DB.prepare("UPDATE events SET registration_mode='invite_only' WHERE slug='pqc-2026'").run();
    const email = "invite.only@gmail.com";
    const { session } = await signInRegistrant(env.DB, email, { firstName: "Casey", lastName: "Fixture" });
    const uninvited = await signInRegistrant(env.DB, "uninvited@gmail.com", { firstName: "Uma", lastName: "Fixture" });
    const inviteId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO invites (id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
       SELECT ?, id, ?, 'attendee', ?, 'sent', 'direct', '2026-01-01T00:00:00.000Z' FROM events WHERE slug='pqc-2026'`,
    )
      .bind(inviteId, email, `sent-${inviteId}`)
      .run();
    const refused = await submit(
      registration("uninvited@gmail.com", { unaffiliatedAttestation: true }),
      uninvited.session,
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "EVENT_REGISTRATION_ACCESS_REQUIRED" } });
    const response = await submit(registration(email, { unaffiliatedAttestation: true }), session);
    expect(response.status, await response.clone().text()).toBe(200);
    const { registrationId } = registrationSubmissionResponseSchema.parse(await response.json());
    expect(await queryAll(env.DB, "SELECT invite_id,status FROM registrations WHERE id=?", registrationId)).toEqual([
      { invite_id: inviteId, status: "registered" },
    ]);
    expect(await queryAll(env.DB, "SELECT status FROM invites WHERE id=?", inviteId)).toEqual([{ status: "accepted" }]);
  });

  it("does not ask an account for the Privacy Policy and Code of Conduct it accepted, and records them for the event", async () => {
    const accepted = await signInRegistrant(env.DB, "accepted.policies@gmail.com", {
      firstName: "Ada",
      lastName: "Fixture",
    });
    await env.DB.batch(
      prepareAccountPolicyAcceptanceStatements(env.DB, {
        userId: accepted.userId,
        accepted: ACCOUNT_POLICIES.map(({ termKey, version }) => ({ termKey, version })),
        at: "2026-01-01T00:00:00.000Z",
      }),
    );
    const response = await submit(
      registration("accepted.policies@gmail.com", { unaffiliatedAttestation: true, consents: [] }),
      accepted.session,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT term_key FROM consent_acceptances WHERE user_id=? ORDER BY term_key",
        accepted.userId,
      ),
    ).toEqual([{ term_key: "code-of-conduct" }, { term_key: "privacy-policy" }]);

    // An account that has not accepted them is asked, and accepting them on the form records them on the account.
    const asked = await signInRegistrant(env.DB, "asked.policies@gmail.com", { firstName: "Bo", lastName: "Fixture" });
    const refused = await submit(
      registration("asked.policies@gmail.com", { unaffiliatedAttestation: true, consents: [] }),
      asked.session,
    );
    expect(refused.status).toBe(400);
    const registered = await submit(
      registration("asked.policies@gmail.com", { unaffiliatedAttestation: true }),
      asked.session,
    );
    expect(registered.status, await registered.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT term_key FROM account_policy_acceptances WHERE user_id=? ORDER BY term_key",
        asked.userId,
      ),
    ).toEqual([{ term_key: "code-of-conduct" }, { term_key: "privacy-policy" }]);
  });

  it("binds an invite-only invitation link to the invited person's account", async () => {
    await env.DB.prepare("UPDATE events SET registration_mode='invite_only' WHERE slug='pqc-2026'").run();
    const [{ id: eventId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug='pqc-2026'");
    const { invite, token } = await createInvite(env.DB, {
      eventId: eventId!,
      inviteeEmail: "invited.work@example.test",
      inviteType: "attendee",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    const forwarded = await signInRegistrant(env.DB, "colleague@gmail.com", { firstName: "Cole", lastName: "Fixture" });
    const refused = await submit(
      registration("colleague@gmail.com", { unaffiliatedAttestation: true, inviteToken: token, inviteId: invite.id }),
      forwarded.session,
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "INVITE_FOR_ANOTHER_ADDRESS" } });

    // The invited address added to another account counts once it is verified.
    const owner = await signInRegistrant(env.DB, "owner.personal@gmail.com", { firstName: "Ola", lastName: "Fixture" });
    await env.DB.prepare(
      `INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at)
       VALUES(?,?,'invited.work@example.test','invited.work@example.test','2026-01-01T00:00:00.000Z','magic_link','2026-01-01T00:00:00.000Z')`,
    )
      .bind(crypto.randomUUID(), owner.userId)
      .run();
    const accepted = await submit(
      registration("owner.personal@gmail.com", {
        unaffiliatedAttestation: true,
        inviteToken: token,
        inviteId: invite.id,
      }),
      owner.session,
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT status FROM invites WHERE id=?", invite.id)).toEqual([
      { status: "accepted" },
    ]);
  });

  it("confirms the signed-in person's earlier unconfirmed registration instead of refusing it", async () => {
    const email = "earlier.pending@gmail.com";
    const pending = await createPendingRegistration(env.DB, { email });
    const { session } = await signInRegistrant(env.DB, email);
    const response = await submit(registration(email, { unaffiliatedAttestation: true }), session);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(result).toMatchObject({ registrationId: pending.registrationId, status: "registered" });
    expect(await queryAll(env.DB, "SELECT id,status FROM registrations WHERE user_id=?", pending.userId)).toEqual([
      { id: pending.registrationId, status: "registered" },
    ]);
  });

  it.each([
    [null, "Fixture"],
    ["Casey", null],
    ["   ", "Fixture"],
    ["casey@example.test", "Fixture"],
    ["Casey", "casey@example.test"],
  ])("requires the signed-in owner to correct saved names (%s, %s)", async (firstName, lastName) => {
    const email = `name-correction-${++sequence}@gmail.com`;
    const { userId, session } = await signInRegistrant(env.DB, email, { firstName, lastName });
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
    const { userId, session } = await signInRegistrant(env.DB, email, { firstName: "Casey", lastName: "Fixture" });
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
    const { userId, session } = await signInRegistrant(env.DB, email, { firstName: "Casey", lastName: "Fixture" });
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
    const { session } = await signInRegistrant(env.DB, "owner@gmail.com", { firstName: "Casey", lastName: "Fixture" });
    const response = await submit(
      registration("someone.else@gmail.com", { unaffiliatedAttestation: true, identityId: crypto.randomUUID() }),
      session,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "REGISTRATION_SESSION_EMAIL_REQUIRED" } });
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
  });

  it("refuses a registration without a session and stores nothing", async () => {
    const response = await submit(registration("casey@gmail.com", { unaffiliatedAttestation: true }));
    expect(response.status, await response.clone().text()).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='casey@gmail.com'")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM consent_acceptances")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key LIKE 'registration_%'")).toEqual([]);
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
    const { session } = await signInRegistrant(env.DB, "unscheduled@gmail.com", {
      firstName: "Casey",
      lastName: "Fixture",
    });
    const response = await submit(registration("unscheduled@gmail.com", { unaffiliatedAttestation: true }), session);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "EVENT_DAYS_NOT_SCHEDULED" } });
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
  });
});
