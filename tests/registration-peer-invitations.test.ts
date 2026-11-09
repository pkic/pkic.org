import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import * as ids from "../functions/_lib/utils/ids";
import { registrationInviteCreateSchema, peerInviteResultSchema } from "../assets/shared/schemas/registration";
import { createRegistration } from "../functions/_lib/services/registrations/create";
import { getEventBySlug } from "../functions/_lib/services/events";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

async function attendee() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, "inviter@example.test");
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET first_name='Alex',last_name='Researcher',email_verified_at=? WHERE id=?").bind(
      at,
      userId,
    ),
    env.DB.prepare(`INSERT INTO event_days(id,event_id,day_date,label,sort_order,attendance_options_json,created_at,updated_at)
      VALUES(?,?,'2026-12-01','Conference day',0,?,?,?)`).bind(
      crypto.randomUUID(),
      eventId,
      JSON.stringify([
        { value: "in_person", label: "In person" },
        { value: "on_demand", label: "On demand" },
      ]),
      at,
      at,
    ),
  ]);
  const event = await getEventBySlug(env.DB, "pqc-2026");
  const created = await createRegistration(env.DB, {
    event,
    userId,
    sourceType: "test",
    mailboxVerified: true,
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  const token = await createMemberSession(env.DB, userId, crypto.randomUUID());
  return { eventId, userId, token, registrationId: created.registration.id, manageToken: created.manageToken };
}
function invite(
  token: string,
  environment = env,
  options: Pick<z.infer<typeof registrationInviteCreateSchema>, "expiresAt"> = {},
) {
  return callApi(environment, "/api/v1/events/pqc-2026/invites", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      ...options,
      invites: [{ firstName: "Casey", lastName: "Colleague", email: "colleague@example.test" }],
    }),
  });
}
describe("attendee self-service invitations", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["session", "capability"] as const)(
    "uses the existing invitation records and outbox through a %s",
    async (mode) => {
      const f = await attendee();
      const profile = profileD1Flow(env.DB);
      const response = await invite(mode === "session" ? f.token : f.manageToken, { ...env, DB: profile.db });
      const report = await profile.report();
      expect(report.roundTrips).toBeLessThanOrEqual(mode === "session" ? 11 : 12);
      expect(report.queries.filter(({ sql }) => sql.includes("INSERT INTO authorization_guards"))).toHaveLength(1);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(peerInviteResultSchema.parse(await response.json()).created).toEqual([
        { email: "colleague@example.test" },
      ]);
      expect(
        await queryAll(
          env.DB,
          "SELECT invite_type,status,invitee_first_name,invitee_last_name,inviter_registration_id FROM invites WHERE invitee_email='colleague@example.test'",
        ),
      ).toEqual([
        {
          invite_type: "attendee",
          status: "sent",
          invitee_first_name: "Casey",
          invitee_last_name: "Colleague",
          inviter_registration_id: f.registrationId,
        },
      ]);
      const mail = await queryAll<{ template_key: string; recipient_email: string; payload_json: string }>(
        env.DB,
        "SELECT template_key,recipient_email,payload_json FROM email_outbox WHERE recipient_email='colleague@example.test'",
      );
      expect(mail).toHaveLength(1);
      expect(mail[0]).toMatchObject({ template_key: "attendee_invite", recipient_email: "colleague@example.test" });
      const payload = await deliveredEmailPayload<{ registrationUrl: string }>(env.DB, env, mail[0].payload_json);
      expect(new URL(payload.registrationUrl).searchParams.get("invite")).toBeTruthy();
      expect((await invite(mode === "session" ? f.token : f.manageToken)).status).toBe(200);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email='colleague@example.test'"),
      ).toHaveLength(1);
    },
  );

  it.each(["session", "capability"] as const)(
    "closes %s invitations at the event start despite a later deadline",
    async (mode) => {
      const f = await attendee();
      const startsAt = nowIso();
      await env.DB.prepare("UPDATE events SET starts_at=? WHERE id=?").bind(startsAt, f.eventId).run();
      const response = await invite(mode === "session" ? f.token : f.manageToken, env, {
        expiresAt: "2026-12-02T09:00:00.000Z",
      });
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "PEER_INVITATIONS_CLOSED" } });
      expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT code FROM referral_codes WHERE owner_id=?", [f.registrationId]),
      ).toHaveLength(0);
    },
  );

  it("caps a requested peer deadline at the start", async () => {
    const f = await attendee();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const response = await invite(f.token, env, { expiresAt: event.ends_at! });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT expires_at FROM invites")).toEqual([{ expires_at: event.starts_at }]);
  });

  it("rolls back all effects when the event starts before the write", async () => {
    const f = await attendee();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => /INSERT(?: OR IGNORE)? INTO invites/i.test(sql),
      async () => {
        await env.DB.prepare("UPDATE events SET starts_at=? WHERE id=?").bind(nowIso(), f.eventId).run();
      },
    );
    const response = await invite(f.token, { ...env, DB: db });
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "EVENT_INVITE_WINDOW_CHANGED" } });
    expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT code FROM referral_codes WHERE owner_id=?", [f.registrationId])).toHaveLength(
      0,
    );
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email='colleague@example.test'"),
    ).toHaveLength(0);
  });

  it.each(["owner", "code"] as const)(
    "retries a concurrent referral %s winner without duplicate emails",
    async (race) => {
      const f = await attendee();
      if (race === "code") vi.spyOn(ids, "randomBase62").mockReturnValueOnce("Collision9");
      const winningCode = race === "owner" ? "OwnerWin9" : "Collision9";
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => /INSERT(?: OR IGNORE)? INTO invites/i.test(sql),
        async () => {
          await env.DB.prepare(`INSERT INTO referral_codes
        (code,event_id,owner_type,owner_id,created_by_user_id,clicks,conversions,created_at)
        VALUES(?,?,'registration',?,?,0,0,?)`)
            .bind(winningCode, f.eventId, race === "owner" ? f.registrationId : crypto.randomUUID(), f.userId, nowIso())
            .run();
        },
      );
      const response = await invite(f.token, { ...env, DB: db });
      expect(response.status, await response.clone().text()).toBe(200);
      const result = peerInviteResultSchema.parse(await response.json());
      const codes = await queryAll<{ code: string }>(env.DB, "SELECT code FROM referral_codes WHERE owner_id=?", [
        f.registrationId,
      ]);
      expect(codes).toEqual([{ code: result.referralCode }]);
      if (race === "owner") expect(result.referralCode).toBe(winningCode);
      else expect(result.referralCode).not.toBe(winningCode);
      expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(1);
      const mail = await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE recipient_email='colleague@example.test'",
      );
      expect(mail).toHaveLength(1);
      const payload = await deliveredEmailPayload<{ registrationUrl: string }>(env.DB, env, mail[0].payload_json);
      expect(new URL(payload.registrationUrl).searchParams.get("ref")).toBe(result.referralCode);
    },
  );

  it("refuses another person's session and cancelled registrations without creating invitations", async () => {
    const f = await attendee();
    const other = await insertUser(env.DB, "other@example.test");
    expect((await invite(await createMemberSession(env.DB, other, crypto.randomUUID()))).status).toBe(403);
    await env.DB.prepare("UPDATE registrations SET status='cancelled',cancelled_at=? WHERE id=?")
      .bind(nowIso(), f.registrationId)
      .run();
    expect((await invite(f.token)).status).toBe(403);
    expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(0);
  });

  it.each(["pending_email_confirmation", "cancelled"])(
    "refuses a %s registration through either credential",
    async (status) => {
      const f = await attendee();
      await env.DB.prepare("UPDATE registrations SET status=? WHERE id=?").bind(status, f.registrationId).run();
      for (const token of [f.token, f.manageToken]) expect((await invite(token)).status).toBe(403);
      expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(0);
    },
  );

  it("rolls back invitations and their emails when the session is revoked before the write", async () => {
    const f = await attendee();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => /INSERT(?: OR IGNORE)? INTO invites/i.test(sql),
      async () => {
        await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.userId).run();
      },
    );
    const response = await invite(f.token, { ...env, DB: db });
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "INVITER_ACCESS_CHANGED" } });
    expect(await queryAll(env.DB, "SELECT code FROM referral_codes WHERE owner_id=?", [f.registrationId])).toHaveLength(
      0,
    );
    expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email='colleague@example.test'"),
    ).toHaveLength(0);
  });

  it("keeps a schedule refusal distinct from inviter authorization and rolls back the referral", async () => {
    const f = await attendee();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => /INSERT(?: OR IGNORE)? INTO invites/i.test(sql),
      async () => {
        await env.DB.prepare("UPDATE events SET ends_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(f.eventId).run();
      },
    );
    const response = await invite(f.token, { ...env, DB: db });
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "EVENT_INVITE_WINDOW_CHANGED" } });
    expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT code FROM referral_codes WHERE owner_id=?", [f.registrationId])).toHaveLength(
      0,
    );
  });
});
