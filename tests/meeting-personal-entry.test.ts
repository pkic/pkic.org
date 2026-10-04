import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import { configureMeetingOccurrence } from "./helpers/meeting-occurrence";
import { createGroupEventSeries, inviteOccurrenceGuest } from "../functions/_lib/services/event-series";
import {
  memberMeetingLinkUrl,
  memberMeetingLinkUrls,
} from "../functions/_lib/services/event-series/personal-entry-links";
import { newCapabilityLinkSecret } from "../functions/_lib/auth/capability-links";
import { signJwt, verifyJwt } from "../functions/_lib/utils/jwt";
import type { AuthAdmin } from "../functions/_lib/types";
import { createMemberSession } from "./helpers/auth";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { PERSONAL_MEETING_LINK_HEADER } from "../assets/shared/schemas/meeting-entry";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";
const SECRET = "personal-entry-test-secret";
const ENCRYPTION = "personal-entry-encryption-secret-000000000000";
const BASE = "https://app.test";

async function send(path: string, method = "GET", body?: unknown, headers?: HeadersInit): Promise<Response> {
  return app.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { ...env, INTERNAL_SIGNING_SECRET: SECRET, MEETING_PROVIDER_ENCRYPTION_KEY: ENCRYPTION } as typeof env,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function fixture() {
  const adminId = await insertUser(env.DB, `personal-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
  const admin: AuthAdmin = { identityType: "user", id: adminId, email: "admin@example.test", role: "admin" };
  const email = `personal-member-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, email);
  await ensureGroupMembershipCapacity(env.DB, GROUP_ID, userId);
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
    eventName: "Personal entry test",
    eventSlug: `personal-entry-${crypto.randomUUID()}`,
    profileKey: "meeting",
    policy: {
      registrationPolicy: "no_registration",
      memberEligibility: "owner_group",
      guestPolicy: "occurrence_invitation",
    },
    startsAt,
    recurrenceRule: "FREQ=WEEKLY;COUNT=2",
    timezone: "UTC",
    durationMinutes: 60,
  });
  const occurrence = await configureMeetingOccurrence(
    env.DB,
    admin,
    GROUP_ID,
    series.id,
    {
      startsAt,
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      providerJoinUrl: "https://meet.example.test/private-personal-room",
    },
    ENCRYPTION,
  );
  const links = await memberMeetingLinkUrls(env.DB, series.id, null, [{ userId, email }], BASE, SECRET);
  const url = memberMeetingLinkUrl(links, userId, email);
  expect(new URL(url).pathname).toBe("/m/");
  return { admin, userId, email, series, occurrence, url, token: new URL(url).hash.slice("#token=".length) };
}

beforeEach(async () => resetDb());

describe("personal meeting entry", () => {
  it("publishes a direct fragment link without consuming the invitation", async () => {
    const { occurrence, url, token } = await fixture();
    expect(url).toBe(`${BASE}/m/#token=${token}`);
    expect((await send(`/m/${token}`)).status).toBe(404);
    const first = await send("/api/v1/meetings/links/resolve", "POST", { token });
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toBeNull();
    expect((await send("/api/v1/meetings/links/resolve", "POST", { token })).status).toBe(200);
    expect((await send(`/api/v1/meetings/occurrences/${occurrence.id}/join`)).status).toBe(401);
    expect((await send("/api/v1/meetings/links/resolve", "POST", { token: `${token.slice(0, -1)}x` })).status).toBe(
      404,
    );
  });

  it("requires initial verification, remembers the browser, and grants meeting entry only", async () => {
    const { userId, occurrence, token } = await fixture();
    const preview = await send("/api/v1/meetings/links/resolve", "POST", { token });
    expect(preview.status, await preview.clone().text()).toBe(200);
    const previewBody = (await preview.json()) as { occurrenceId: string; name: string };
    expect(previewBody.occurrenceId).toBe(occurrence.id);
    expect(previewBody.name).toBeTruthy();
    expect(JSON.stringify(previewBody)).not.toContain("private-personal-room");

    const path = `/api/v1/meetings/occurrences/${occurrence.id}`;
    const unknownBrowser = await send(`${path}/links/session`, "POST", { token });
    expect(await unknownBrowser.json()).toMatchObject({ status: "verify", verification: "member" });
    const memberToken = await createMemberSession(env.DB, userId, "personal-entry", SECRET);
    const verified = await send(
      `${path}/links/session`,
      "POST",
      { token },
      {
        authorization: `Bearer ${memberToken}`,
      },
    );
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(await verified.json()).toMatchObject({ status: "ready" });
    const cookie = verified.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("pkic_meeting_entry=");
    expect(verified.headers.get("set-cookie")).toContain("Max-Age=");

    const landingResponse = await send(`${path}/join`, "GET", undefined, { cookie });
    expect(landingResponse.status, await landingResponse.clone().text()).toBe(200);
    const landing = (await landingResponse.json()) as { landingRevision: string };
    expect(JSON.stringify(landing)).not.toContain("private-personal-room");
    const joined = await send(
      `${path}/join`,
      "POST",
      {
        landingRevision: landing.landingRevision,
        acceptedTerms: [],
        intentionalJoin: true,
      },
      { cookie },
    );
    expect(joined.status, await joined.clone().text()).toBe(200);
    expect(await joined.json()).toMatchObject({ redirectUrl: "https://meet.example.test/private-personal-room" });
    const attendance = await env.DB.prepare(
      "SELECT attendance_verified_at FROM event_occurrence_join_confirmations WHERE occurrence_id = ? AND user_id = ?",
    )
      .bind(occurrence.id, userId)
      .first<{ attendance_verified_at: string | null }>();
    expect(attendance?.attendance_verified_at).toBeNull();
    expect((await send("/api/v1/users/current/meetings", "GET", undefined, { cookie })).status).toBe(401);
    expect((await send(`${path}/links/session`, "POST", { token })).status).toBe(200);
  });

  it("rejects a tampered link and a forwarded link on an unverified browser", async () => {
    const { userId, occurrence, token } = await fixture();
    const path = `/api/v1/meetings/occurrences/${occurrence.id}`;
    const memberToken = await createMemberSession(env.DB, userId, "original-browser", SECRET);
    const claimed = await send(
      `${path}/links/session`,
      "POST",
      { token },
      {
        authorization: `Bearer ${memberToken}`,
      },
    );
    expect(((await claimed.json()) as { status: string }).status).toBe("ready");
    const forwarded = await send(`${path}/links/session`, "POST", { token });
    expect(await forwarded.json()).toMatchObject({ status: "verify" });
    expect((await send(`${path}/join`, "GET", undefined, { [PERSONAL_MEETING_LINK_HEADER]: token })).status).toBe(401);
    expect((await send("/api/v1/meetings/links/resolve", "POST", { token: `${token.slice(0, -1)}x` })).status).toBe(
      404,
    );
  });

  it("remembers separate personal links on the same browser without replacing the first", async () => {
    const { userId, series, occurrence, token } = await fixture();
    const secondEmail = `second-member-${crypto.randomUUID()}@example.test`;
    const secondUserId = await insertUser(env.DB, secondEmail);
    await ensureGroupMembershipCapacity(env.DB, GROUP_ID, secondUserId);
    const secondLinks = await memberMeetingLinkUrls(
      env.DB,
      series.id,
      null,
      [{ userId: secondUserId, email: secondEmail }],
      BASE,
      SECRET,
    );
    const secondToken = new URL(memberMeetingLinkUrl(secondLinks, secondUserId, secondEmail)).hash.slice(
      "#token=".length,
    );
    const path = `/api/v1/meetings/occurrences/${occurrence.id}`;
    const firstAuth = await createMemberSession(env.DB, userId, "first-member", SECRET);
    const first = await send(`${path}/links/session`, "POST", { token }, { authorization: `Bearer ${firstAuth}` });
    expect(await first.json()).toMatchObject({ status: "ready" });
    const browserCookie = first.headers.get("set-cookie")?.split(";")[0] ?? "";
    const secondAuth = await createMemberSession(env.DB, secondUserId, "second-member", SECRET);
    const second = await send(
      `${path}/links/session`,
      "POST",
      { token: secondToken },
      { cookie: browserCookie, authorization: `Bearer ${secondAuth}` },
    );
    expect(await second.json()).toMatchObject({ status: "ready" });
    const combinedCookie = second.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(combinedCookie).toContain("pkic_meeting_entry=");
    expect(second.headers.get("set-cookie")).toContain("Max-Age=");
    const specificallyFirst = (await (
      await send(`${path}/join`, "GET", undefined, {
        cookie: combinedCookie,
        [PERSONAL_MEETING_LINK_HEADER]: token,
      })
    ).json()) as { landingRevision: string };
    const specificallySecond = (await (
      await send(`${path}/join`, "GET", undefined, {
        cookie: combinedCookie,
        [PERSONAL_MEETING_LINK_HEADER]: secondToken,
      })
    ).json()) as { landingRevision: string };
    expect(specificallyFirst.landingRevision).not.toBe(specificallySecond.landingRevision);
    const reopened = await send(`${path}/links/session`, "POST", { token }, { cookie: combinedCookie });
    expect(await reopened.json()).toMatchObject({ status: "ready" });
    const firstLanding = specificallyFirst;
    const signedInAsSecond = await send(`${path}/join`, "GET", undefined, {
      cookie: combinedCookie,
      authorization: `Bearer ${secondAuth}`,
    });
    expect(signedInAsSecond.status).toBe(200);
    const secondLanding = (await signedInAsSecond.json()) as { landingRevision: string };
    expect(secondLanding.landingRevision).not.toBe(firstLanding.landingRevision);
    const joinedAsSecond = await send(
      `${path}/join`,
      "POST",
      { landingRevision: secondLanding.landingRevision, acceptedTerms: [], intentionalJoin: true },
      { cookie: combinedCookie, authorization: `Bearer ${secondAuth}` },
    );
    expect(joinedAsSecond.status, await joinedAsSecond.clone().text()).toBe(200);
    const confirmation = await env.DB.prepare(
      "SELECT user_id FROM event_occurrence_join_confirmations WHERE occurrence_id = ? AND user_id = ?",
    )
      .bind(occurrence.id, secondUserId)
      .first<{ user_id: string }>();
    expect(confirmation?.user_id).toBe(secondUserId);
  });

  it("verifies a guest mailbox once before remembering only meeting access", async () => {
    const { admin, userId, series, occurrence } = await fixture();
    const invited = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: `personal-guest-${crypto.randomUUID()}@example.test`,
        name: "Personal Guest",
        expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
      },
      BASE,
      SECRET,
    );
    const queued = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE id = ?")
      .bind(invited.outboxId)
      .first<{ payload_json: string }>();
    const url = JSON.parse(queued!.payload_json).invitationUrl as string;
    expect(url).toMatch(/^https:\/\/app\.test\/m\/#token=g2\./);
    const token = new URL(url).hash.slice("#token=".length);
    const path = `/api/v1/meetings/occurrences/${occurrence.id}`;
    const unknown = await send(`${path}/links/session`, "POST", { token });
    expect(await unknown.json()).toMatchObject({ status: "verify", verification: "guest" });

    const started = await send(`${path}/links/verifications`, "POST", { token });
    expect(started.status, await started.clone().text()).toBe(202);
    const challenge = (await started.json()) as { verificationId: string };
    const challengeCookie = started.headers.get("set-cookie")?.split(";")[0] ?? "";
    const codeRows = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE idempotency_key = ?")
      .bind(`meeting-guest-verification-code:${challenge.verificationId}`)
      .all<{ payload_json: string }>();
    const code = JSON.parse(codeRows.results[0].payload_json).verificationCode as string;
    const completed = await send(
      `${path}/invitations/verifications/${challenge.verificationId}`,
      "PATCH",
      {
        code,
      },
      { cookie: challengeCookie },
    );
    expect(completed.status, await completed.clone().text()).toBe(200);
    const guestCookie = completed.headers.get("set-cookie")?.match(/pkic_meeting_guest_session=[^;]+/)?.[0] ?? "";
    expect(guestCookie).toBeTruthy();
    const portalAuth = await createMemberSession(env.DB, userId, "portal-user-with-guest-invite", SECRET);
    const ready = await send(
      `${path}/links/session`,
      "POST",
      { token },
      { cookie: guestCookie, authorization: `Bearer ${portalAuth}` },
    );
    expect(ready.status, await ready.clone().text()).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ready", name: "Personal Guest" });
    const browserCookie = ready.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await send(`${path}/join`, "GET", undefined, { cookie: browserCookie })).status).toBe(200);
    const guestLanding = await send(`${path}/join`, "GET", undefined, {
      cookie: browserCookie,
      authorization: `Bearer ${portalAuth}`,
      [PERSONAL_MEETING_LINK_HEADER]: token,
    });
    expect(guestLanding.status).toBe(200);
    expect(await guestLanding.json()).toMatchObject({ name: "Personal Guest" });
    expect((await send("/api/v1/users/current/meetings", "GET", undefined, { cookie: browserCookie })).status).toBe(
      401,
    );
  });

  it("requires a new sign-in after an always-authenticate join", async () => {
    const { userId, series, occurrence, token } = await fixture();
    await env.DB.prepare(
      `UPDATE events SET settings_json = json_set(settings_json,
        '$.meetingEntryPolicy.authentication', 'always') WHERE id = ?`,
    )
      .bind(series.eventId)
      .run();
    const path = `/api/v1/meetings/occurrences/${occurrence.id}`;
    const firstAuth = await createMemberSession(env.DB, userId, "always-first", SECRET);
    const established = await send(
      `${path}/links/session`,
      "POST",
      { token },
      {
        authorization: `Bearer ${firstAuth}`,
      },
    );
    expect(await established.json()).toMatchObject({ status: "ready" });
    const cookie = established.headers.get("set-cookie")?.split(";")[0] ?? "";
    const landing = (await (await send(`${path}/join`, "GET", undefined, { cookie })).json()) as {
      landingRevision: string;
    };
    expect(
      (
        await send(
          `${path}/join`,
          "POST",
          {
            landingRevision: landing.landingRevision,
            acceptedTerms: [],
            intentionalJoin: true,
          },
          { cookie },
        )
      ).status,
    ).toBe(200);
    const repeated = await send(
      `${path}/links/session`,
      "POST",
      { token },
      {
        cookie,
        authorization: `Bearer ${firstAuth}`,
      },
    );
    expect(await repeated.json()).toMatchObject({ status: "verify" });
    expect((await send(`${path}/join`, "GET", undefined, { cookie })).status).toBe(401);
    const nextAuth = await createMemberSession(env.DB, userId, "always-second", SECRET);
    const again = await send(
      `${path}/links/session`,
      "POST",
      { token },
      {
        cookie,
        authorization: `Bearer ${nextAuth}`,
      },
    );
    expect(await again.json()).toMatchObject({ status: "ready" });
    expect(again.headers.get("set-cookie")).toContain("pkic_meeting_entry=");
  });

  it("honors shorter policy and link revocation at the join boundary", async () => {
    const { userId, series, occurrence, token } = await fixture();
    const path = `/api/v1/meetings/occurrences/${occurrence.id}`;
    const auth = await createMemberSession(env.DB, userId, "policy-shortened", SECRET);
    const established = await send(
      `${path}/links/session`,
      "POST",
      { token },
      {
        authorization: `Bearer ${auth}`,
      },
    );
    const cookie = established.headers.get("set-cookie")?.split(";")[0] ?? "";
    await env.DB.prepare(
      `UPDATE events SET settings_json = json_set(settings_json,
        '$.meetingEntryPolicy.rememberDays', 1) WHERE id = ?`,
    )
      .bind(series.eventId)
      .run();
    const verified = await verifyJwt<{ typ: string; grants: Array<Record<string, unknown>>; exp: number }>(
      SECRET,
      cookie.split("=")[1],
    );
    if (!verified.ok) throw new Error("Expected signed browser proof");
    verified.claims.grants[0].authenticatedAt = Date.now() - 2 * 86400_000;
    const agedCookie = `pkic_meeting_entry=${await signJwt(SECRET, verified.claims)}`;
    expect((await send(`${path}/join`, "GET", undefined, { cookie: agedCookie })).status).toBe(401);
    await env.DB.prepare("UPDATE users SET link_secret = ? WHERE id = ?").bind(newCapabilityLinkSecret(), userId).run();
    expect((await send("/api/v1/meetings/links/resolve", "POST", { token })).status).toBe(404);
    expect((await send(`${path}/join`, "GET", undefined, { cookie })).status).toBe(401);
  });

  it("uses stable signed links without per-invitation link tables", async () => {
    const { userId, email, series, token } = await fixture();
    const regenerated = await memberMeetingLinkUrls(env.DB, series.id, null, [{ userId, email }], BASE, SECRET);
    expect(new URL(memberMeetingLinkUrl(regenerated, userId, email)).hash.slice("#token=".length)).toBe(token);
    const linkTables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'meeting_entry_%'",
    ).all();
    expect(linkTables.results).toEqual([]);
  });
});
