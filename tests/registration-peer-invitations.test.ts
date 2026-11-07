import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { peerInviteResultSchema } from "../assets/shared/schemas/registration";
import { createRegistration } from "../functions/_lib/services/registrations/create";
import { getEventBySlug } from "../functions/_lib/services/events";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
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
function invite(token: string, environment = env) {
  return callApi(environment, "/api/v1/events/pqc-2026/invites", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ invites: [{ firstName: "Casey", lastName: "Colleague", email: "colleague@example.test" }] }),
  });
}
describe("attendee self-service invitations and notifications", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["session", "capability"] as const)(
    "uses the existing invitation records and outbox through a %s",
    async (mode) => {
      const f = await attendee();
      const response = await invite(mode === "session" ? f.token : f.manageToken);
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
    expect(await queryAll(env.DB, "SELECT id FROM invites")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email='colleague@example.test'"),
    ).toHaveLength(0);
  });

  it("queues update and cancellation emails through the signed-in registration endpoint", async () => {
    const f = await attendee();
    const patch = (body: unknown) =>
      callApi(env, `/api/v1/registrations/${f.registrationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${f.token}` },
        body: JSON.stringify(body),
      });
    const before = await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='registration_updated'");
    expect(before).toHaveLength(0);
    const update = await patch({
      action: "update",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "on_demand" }],
    });
    expect(update.status, await update.clone().text()).toBe(200);
    let mail = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key='registration_updated' AND recipient_email='inviter@example.test'",
    );
    expect(mail).toHaveLength(1);
    expect(await deliveredEmailPayload(env.DB, env, mail[0].payload_json)).toMatchObject({
      registrationStatus: "registered",
    });
    const unchanged = await patch({
      action: "update",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "on_demand" }],
    });
    expect(unchanged.status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='registration_updated'"),
    ).toHaveLength(1);
    const cancellation = await patch({ action: "cancel" });
    expect(cancellation.status, await cancellation.clone().text()).toBe(200);
    mail = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key='registration_updated' AND recipient_email='inviter@example.test'",
    );
    expect(mail).toHaveLength(2);
    const payloads = await Promise.all(mail.map((row) => deliveredEmailPayload(env.DB, env, row.payload_json)));
    expect(payloads).toContainEqual(expect.objectContaining({ registrationStatus: "cancelled" }));
  });
});
