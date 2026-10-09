import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { webPushFixture, decryptPushFixture, verifyVapidFixture } from "./helpers/web-push";
import {
  webPushConfiguration,
  eventWebPushConfiguration,
} from "../functions/_lib/services/event-participation/web-push-configuration";
import {
  registerEventWebPush,
  eventWebPushStatus,
  revokeEventWebPush,
  revokeOwnedWebPushDevice,
} from "../functions/_lib/services/event-participation/web-push-subscriptions";
import {
  queueAgendaPushReminders,
  prepareAgendaPushChangeNotifications,
} from "../functions/_lib/services/event-participation/web-push-intents";
import { processAgendaPushOutbox } from "../functions/_lib/services/event-participation/web-push-outbox";
import { deliverWebPush } from "../functions/_lib/services/event-participation/web-push-transport";
import {
  eventWebPushRegisterSchema,
  webPushEndpointSchema,
  webPushNotificationSchema,
} from "../assets/shared/schemas/event-web-push";
let eventId: string,
  userId: string,
  otherId: string,
  deviceId: string,
  token: string,
  fixture: Awaited<ReturnType<typeof webPushFixture>>;
async function register() {
  return registerEventWebPush(env.DB, fixture.config, eventId, userId, {
    deviceId,
    subscription: fixture.subscription,
    enabled: true,
    reminderMinutes: 15,
  });
}
async function reminder() {
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    start = new Date(Date.now() + 600000).toISOString(),
    end = new Date(Date.now() + 3600000).toISOString();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES(?,?,'Private session name',?,?)",
  )
    .bind(id, eventId, start, end)
    .run();
  await env.DB.prepare(
    "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'physical','reserved',?,?)",
  )
    .bind(crypto.randomUUID(), eventId, id, userId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO agenda_calendar_entries(event_id,occurrence_id,user_id,sequence,revision,status,title,start_at,end_at,updated_at) VALUES(?,?,?,1,1,'confirmed','Private session name',?,?,?)",
  )
    .bind(eventId, id, userId, start, end, now)
    .run();
  await env.DB.prepare(
    "UPDATE event_agenda_publications SET snapshot_json=json_insert(snapshot_json,'$.occurrences[#]',json(?)) WHERE event_id=? AND revision=1",
  )
    .bind(JSON.stringify({ id, title: "Private session name", startAt: start, endAt: end, roomId: null }), eventId)
    .run();
  return id;
}

describe("Opt-in browser agenda notifications", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
    // Normal attendees, including nonmembers, use the same authenticated lifecycle.
    await env.DB.prepare(
      `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE user_id=? AND role_id='role-admin'
        AND context_type IS NULL AND context_id IS NULL AND revoked_at IS NULL`,
    )
      .bind(userId)
      .run();
    otherId = crypto.randomUUID();
    deviceId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(otherId, `${otherId}@example.test`, `${otherId}@example.test`)
      .run();
    token = await createAdminSession(env.DB, userId, crypto.randomUUID());
    fixture = await webPushFixture();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,1,1,?)",
    )
      .bind(eventId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        JSON.stringify({ timeZone: "Europe/Amsterdam", occurrences: [], rooms: [] }),
        userId,
        now,
      )
      .run();
  });
  it("stays disabled for missing or mismatched VAPID configuration without writes or transport", async () => {
    expect(await eventWebPushConfiguration({})).toEqual({ available: false, publicKey: null });
    const second = await webPushFixture();
    expect(
      await webPushConfiguration({ ...fixture.config, VAPID_PRIVATE_KEY: second.config.VAPID_PRIVATE_KEY }),
    ).toBeNull();
    await expect(
      registerEventWebPush(env.DB, {}, eventId, userId, {
        deviceId,
        subscription: fixture.subscription,
        enabled: true,
        reminderMinutes: 15,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      await processAgendaPushOutbox(env.DB, {}, 20, async () => {
        throw new Error("must not send");
      }),
    ).toEqual({ configured: false, inspected: 0, accepted: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM agenda_push_devices").first()).toEqual({ total: 0 });
  });
  it("stores only encrypted subscription capabilities with owned event consent and safe audit metadata", async () => {
    expect(await register()).toMatchObject({ deviceId, enabled: true, registered: true });
    const row = await env.DB.prepare("SELECT subscription_ciphertext FROM agenda_push_devices WHERE id=?")
      .bind(deviceId)
      .first<{ subscription_ciphertext: string }>();
    expect(row!.subscription_ciphertext).not.toContain(fixture.subscription.endpoint);
    const audits = await env.DB.prepare("SELECT details_json FROM audit_log WHERE entity_id=?").bind(deviceId).all();
    expect(JSON.stringify(audits)).not.toContain(fixture.subscription.keys.auth);
    expect(JSON.stringify(audits)).not.toContain(fixture.subscription.endpoint);
    await expect(eventWebPushStatus(env.DB, eventId, otherId, deviceId)).rejects.toMatchObject({ status: 403 });
    await expect(
      registerEventWebPush(env.DB, fixture.config, eventId, otherId, {
        deviceId: crypto.randomUUID(),
        subscription: fixture.subscription,
        enabled: true,
        reminderMinutes: 15,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects private hosts, credentials, arbitrary ports and malformed browser subscription keys", async () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/send",
      "https://localhost/push",
      "https://127.0.0.1/push",
      "https://user:pass@fcm.googleapis.com/send",
      "https://fcm.googleapis.com:8443/send",
      "https://fcm.googleapis.com.evil.test/send",
    ])
      expect(webPushEndpointSchema.safeParse(endpoint).success).toBe(false);
    expect(
      eventWebPushRegisterSchema.safeParse({
        deviceId,
        subscription: { ...fixture.subscription, keys: { p256dh: "x", auth: "x" } },
        enabled: true,
        reminderMinutes: 15,
      }).success,
    ).toBe(false);
  });
  it("encrypts and authenticates real native Worker transport independently and preserves TTL zero", async () => {
    const config = (await webPushConfiguration(fixture.config))!;
    const notification = webPushNotificationSchema.parse({
      notificationId: crypto.randomUUID(),
      kind: "session_reminder",
      destination: "/portal/#/events/pqc-2026/agenda",
    });
    const captured: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const result = await deliverWebPush(fixture.subscription, notification, config, 0, async (input, init) => {
      captured.push({ input, init });
      return new Response(null, { status: 201 });
    });
    expect(captured).toHaveLength(1);
    // Run evidence assertions outside the transport retry boundary; failures must retain their actual cause.
    const sent = captured[0];
    if (!sent) throw new Error("Push transport did not receive a request");
    const request = new Request(sent.input, sent.init);
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("ttl")).toBe("0");
    expect(request.headers.get("content-encoding")).toBe("aes128gcm");
    const body = await request.arrayBuffer();
    expect(body.byteLength).toBe(4096);
    expect(await decryptPushFixture(body, fixture)).toEqual(notification);
    const vapid = await verifyVapidFixture(request.headers.get("authorization")!, fixture);
    expect(vapid.valid).toBe(true);
    expect(vapid.claims.aud).toBe("https://fcm.googleapis.com");
    expect(vapid.claims.exp).toBeGreaterThan(Date.now() / 1000);
    expect(vapid.claims.exp).toBeLessThan(Date.now() / 1000 + 86400);
    expect(result).toEqual({ status: "accepted", code: "accepted_by_push_service" });
  });
  it("refuses push-service redirects without requesting the redirected destination", async () => {
    const config = (await webPushConfiguration(fixture.config))!;
    const sent: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const result = await deliverWebPush(
      fixture.subscription,
      { notificationId: crypto.randomUUID(), kind: "agenda_changed", destination: "/portal/#/events/pqc-2026/agenda" },
      config,
      60,
      async (input, init) => {
        sent.push({ input, init });
        return new Response("Do not read provider content", {
          status: 307,
          headers: { location: "https://127.0.0.1/private" },
        });
      },
    );
    expect(result).toEqual({ status: "failed", code: "provider_redirect_blocked" });
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toBe(fixture.subscription.endpoint);
    expect(new Request(sent[0].input, sent[0].init).redirect).toBe("manual");
  });
  it("deduplicates scheduled intents and cancels outdated sequence or withdrawn consent before dispatch", async () => {
    await register();
    const occurrenceId = await reminder();
    const queued = await queueAgendaPushReminders(env.DB);
    if (queued.queued !== 1)
      throw new Error(
        JSON.stringify({
          queued,
          outbox: (
            await env.DB.prepare(
              "SELECT kind,status,day_date,source_version,idempotency_key FROM agenda_push_outbox",
            ).all()
          ).results,
          entry: (await env.DB.prepare("SELECT sequence,status,start_at FROM agenda_calendar_entries").all()).results,
          registration: (await env.DB.prepare("SELECT status,attendance_type FROM registrations").all()).results,
        }),
      );
    expect(queued).toEqual({ queued: 1 });
    // A reminder opens the event app's agenda filtered to the reader's own sessions.
    expect(await env.DB.prepare("SELECT destination FROM agenda_push_outbox").first("destination")).toMatch(
      /^\/portal\/#\/events\/[a-z0-9-]+\/agenda\?mine=1$/,
    );
    expect(await queueAgendaPushReminders(env.DB)).toEqual({ queued: 0 });
    await env.DB.prepare("UPDATE agenda_calendar_entries SET sequence=2 WHERE occurrence_id=?")
      .bind(occurrenceId)
      .run();
    let sent = 0;
    await processAgendaPushOutbox(env.DB, fixture.config, 20, async () => {
      sent++;
      return new Response(null, { status: 201 });
    });
    expect(sent).toBe(0);
    expect((await env.DB.prepare("SELECT status FROM agenda_push_outbox").first<{ status: string }>())!.status).toBe(
      "canceled",
    );
    expect(await queueAgendaPushReminders(env.DB)).toEqual({ queued: 1 });
    await revokeEventWebPush(env.DB, eventId, userId, deviceId);
    await processAgendaPushOutbox(env.DB, fixture.config, 20, async () => {
      sent++;
      return new Response(null, { status: 201 });
    });
    expect(sent).toBe(0);
  });
  it("records provider acceptance without fabricated browser display evidence and keeps email preferences intact", async () => {
    await register();
    await reminder();
    await queueAgendaPushReminders(env.DB);
    const result = await processAgendaPushOutbox(
      env.DB,
      fixture.config,
      20,
      async () => new Response(null, { status: 201 }),
    );
    expect(result.accepted).toBe(1);
    expect(await env.DB.prepare("SELECT status,last_error_code FROM agenda_push_outbox").first()).toEqual({
      status: "accepted",
      last_error_code: "accepted_by_push_service",
    });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) total FROM agenda_calendar_preferences").first<{ total: number }>())!
        .total,
    ).toBe(0);
  });
  it("revokes expired provider subscriptions and prevents replay after device-wide signout cleanup", async () => {
    await register();
    await reminder();
    await queueAgendaPushReminders(env.DB);
    await processAgendaPushOutbox(env.DB, fixture.config, 20, async () => new Response(null, { status: 410 }));
    expect(await eventWebPushStatus(env.DB, eventId, userId, deviceId)).toMatchObject({
      registered: false,
      enabled: false,
      revoked: true,
    });
    await register();
    await revokeOwnedWebPushDevice(env.DB, userId, deviceId);
    expect(
      (await env.DB.prepare("SELECT subscription_ciphertext FROM agenda_push_devices WHERE id=?")
        .bind(deviceId)
        .first<{ subscription_ciphertext: string }>())!.subscription_ciphertext,
    ).toBe("");
    await expect(revokeOwnedWebPushDevice(env.DB, otherId, deviceId)).rejects.toMatchObject({ status: 403 });
  });
  it("retains bounded retry evidence for rate limiting, uncertain transport and final provider refusals", async () => {
    const config = (await webPushConfiguration(fixture.config))!,
      notification = {
        notificationId: crypto.randomUUID(),
        kind: "agenda_changed" as const,
        destination: "/portal/#/events/pqc-2026/agenda",
      };
    expect(
      await deliverWebPush(
        fixture.subscription,
        notification,
        config,
        60,
        async () => new Response(null, { status: 429, headers: { "retry-after": "999999" } }),
      ),
    ).toMatchObject({ status: "retry", retryAfterMs: 3600000 });
    expect(
      await deliverWebPush(fixture.subscription, notification, config, 60, async () => {
        throw new Error("Sensitive endpoint/provider error");
      }),
    ).toEqual({ status: "retry", code: "transport_uncertain" });
    expect(
      await deliverWebPush(
        fixture.subscription,
        notification,
        config,
        60,
        async () => new Response(null, { status: 403 }),
      ),
    ).toEqual({ status: "failed", code: "provider_refused" });
  });
  it("prepares only opted-in participating users for atomic approved agenda changes", async () => {
    await register();
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Changed')")
      .bind(id, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'physical','saved',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, id, userId, now, now)
      .run();
    await env.DB.batch(prepareAgendaPushChangeNotifications(env.DB, eventId, 2, [id]));
    await env.DB.batch(prepareAgendaPushChangeNotifications(env.DB, eventId, 2, [id]));
    expect(await env.DB.prepare("SELECT COUNT(*) total FROM agenda_push_outbox").first()).toEqual({ total: 1 });
  });
  it("rechecks consent after encryption and does not send when a device is revoked", async () => {
    await register();
    const config = (await webPushConfiguration(fixture.config))!;
    let calls = 0;
    const result = await deliverWebPush(
      fixture.subscription,
      {
        notificationId: crypto.randomUUID(),
        kind: "session_reminder",
        destination: "/portal/#/events/pqc-2026/agenda",
      },
      config,
      60,
      async () => {
        calls++;
        return new Response(null, { status: 201 });
      },
      async () => {
        await revokeOwnedWebPushDevice(env.DB, userId, deviceId);
        return false;
      },
    );
    expect(calls).toBe(0);
    expect(result).toEqual({ status: "failed", code: "consent_changed" });
  });
  it("does not revoke a replacement browser subscription from an older provider response", async () => {
    await register();
    await reminder();
    await queueAgendaPushReminders(env.DB);
    const replacement = await webPushFixture();
    await processAgendaPushOutbox(env.DB, fixture.config, 20, async () => {
      await registerEventWebPush(env.DB, fixture.config, eventId, userId, {
        deviceId,
        subscription: replacement.subscription,
        enabled: true,
        reminderMinutes: 15,
      });
      return new Response(null, { status: 410 });
    });
    expect(await eventWebPushStatus(env.DB, eventId, userId, deviceId)).toMatchObject({
      registered: true,
      revoked: false,
      enabled: true,
    });
  });
  it("bounds provider dispatch and leaves the remaining durable intents for the next run", async () => {
    await register();
    for (let index = 0; index < 7; index++) await reminder();
    await queueAgendaPushReminders(env.DB);
    let sends = 0;
    expect(
      await processAgendaPushOutbox(env.DB, fixture.config, 3, async () => {
        sends++;
        return new Response(null, { status: 201 });
      }),
    ).toMatchObject({ inspected: 3, accepted: 3 });
    expect(sends).toBe(3);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) total FROM agenda_push_outbox WHERE status='queued'").first<{
        total: number;
      }>())!.total,
    ).toBe(4);
  });
  it("mounted lifecycle accepts a normal attendee but prevents another user's device reads", async () => {
    const target = { ...env, ...fixture.config };
    const config = await callApi(target, "/api/v1/events/pqc-2026/push/config", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(config.status).toBe(200);
    expect(config.headers.get("cache-control")).toContain("no-store");
    const response = await callApi(target, "/api/v1/events/pqc-2026/push/devices", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(
        eventWebPushRegisterSchema.parse({
          deviceId,
          subscription: fixture.subscription,
          enabled: true,
          reminderMinutes: 15,
        }),
      ),
    });
    expect(response.status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        otherId,
        crypto.randomUUID(),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    const otherToken = await createAdminSession(env.DB, otherId, crypto.randomUUID());
    expect(
      (
        await callApi(target, `/api/v1/events/pqc-2026/push/devices/${deviceId}`, {
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).status,
    ).toBe(403);
  });
  it("mounted device-wide cleanup revokes every event while refusing another attendee's device", async () => {
    await register();
    const secondEvent = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,?,'Second event','UTC','invite_or_open','{}',?,?)",
    )
      .bind(secondEvent, secondEvent, now, now)
      .run();
    await registerEventWebPush(env.DB, fixture.config, secondEvent, userId, {
      deviceId,
      subscription: fixture.subscription,
      enabled: true,
      reminderMinutes: 15,
    });
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, otherId, crypto.randomUUID(), now, now)
      .run();
    const otherToken = await createAdminSession(env.DB, otherId, crypto.randomUUID());
    const path = `/api/v1/users/current/push/devices/${deviceId}`;
    expect((await callApi(env, path, { method: "DELETE" })).status).toBe(401);
    expect(
      (await callApi(env, path, { method: "DELETE", headers: { authorization: `Bearer ${otherToken}` } })).status,
    ).toBe(403);
    expect(await eventWebPushStatus(env.DB, eventId, userId, deviceId)).toMatchObject({ enabled: true });
    const response = await callApi(env, path, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(await eventWebPushStatus(env.DB, eventId, userId, deviceId)).toMatchObject({
      enabled: false,
      revoked: true,
      registered: false,
    });
    expect(await eventWebPushStatus(env.DB, secondEvent, userId, deviceId)).toMatchObject({
      enabled: false,
      revoked: true,
      registered: false,
    });
  });
});
