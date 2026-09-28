import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import ICAL from "ical.js";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import type { Env } from "../functions/_lib/types";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration } from "../functions/_lib/services/registrations";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const signingSecret = "personal-event-calendar-test-secret";

async function download(registrationId: string, token?: string) {
  return app.fetch(
    new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/calendar.ics`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { ...(env as unknown as Env), INTERNAL_SIGNING_SECRET: signingSecret, RSVP_EMAIL: "rsvp@example.test" },
    createExecutionContext(),
  );
}

describe("personal event calendar", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("downloads the active attendee's existing calendar identity and denies other identities", async () => {
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const attendeeEmail = `calendar-attendee-${crypto.randomUUID()}@example.test`;
    const attendeeId = await insertUser(env.DB, attendeeEmail);
    const [other] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    const created = await createRegistration(env.DB, {
      event,
      userId: attendeeId,
      attendanceType: "virtual",
      sourceType: "direct",
      signingSecret,
    });
    const registrationId = created.registration.id;
    await env.DB.prepare("UPDATE registrations SET status = 'registered' WHERE id = ?").bind(registrationId).run();
    const attendeeToken = await createAdminSession(env.DB, attendeeId, crypto.randomUUID(), signingSecret);
    const otherToken = await createAdminSession(env.DB, other.id, crypto.randomUUID(), signingSecret);

    expect((await download(registrationId)).status).toBe(401);
    expect((await download(registrationId, otherToken)).status).toBe(404);
    const response = await download(registrationId, attendeeToken);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("pqc-2026-personal.ics");
    const calendar = new ICAL.Component(ICAL.parse(await response.text()));
    const invitation = calendar.getFirstSubcomponent("vevent")!;
    expect(String(invitation.getFirstPropertyValue("uid"))).toContain(registrationId);
    expect(String(invitation.getFirstPropertyValue("attendee"))).toContain(attendeeEmail);
    expect(String(invitation.getFirstPropertyValue("organizer"))).toContain("rsvp");

    await env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").bind(registrationId).run();
    expect((await download(registrationId, attendeeToken)).status).toBe(404);
  });
});
