import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../functions/router";
import { materializeQueuedCapabilityLinks } from "../functions/_lib/auth/capability-links";
import {
  prepareMeetingGuestBrowserChallenge,
  verifyMeetingGuestInvitationCapability,
} from "../functions/_lib/auth/meeting-guest-challenge";
import { processOutboxById } from "../functions/_lib/email/outbox";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import {
  createGroupEventSeries,
  createSeriesOccurrence,
  inviteOccurrenceGuest,
} from "../functions/_lib/services/event-series";
import type { AuthAdmin, DatabaseLike, Env, StatementLike } from "../functions/_lib/types";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";
const SIGNING_SECRET = "meeting-guest-invitation-signing-secret";
const ENCRYPTION_SECRET = "meeting-guest-invitation-encryption-secret-000000000";
const APP_BASE_URL = "https://app.test";

async function seedActiveTemplate(
  adminId: string,
  templateKey: string,
  subjectTemplate: string,
  content: string,
): Promise<void> {
  const template = await createTemplateVersion(env.DB, {
    templateKey,
    content,
    subjectTemplate,
    createdByUserId: adminId,
  });
  await activateTemplateVersion(env.DB, { templateKey, version: template.version });
}

async function fixture() {
  const adminId = await insertUser(env.DB, `meeting-invitation-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
  const admin: AuthAdmin = {
    identityType: "user",
    id: adminId,
    email: "meeting-invitation-admin@example.test",
    role: "admin",
  };
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
    eventName: "External guest architecture review",
    eventSlug: `external-guest-${crypto.randomUUID()}`,
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
    location: "Online",
    providerType: "external_url",
  });
  const occurrence = await createSeriesOccurrence(
    env.DB,
    admin,
    GROUP_ID,
    series.id,
    {
      startsAt,
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      providerJoinUrl: "https://meet.example.test/external-guest-room",
    },
    ENCRYPTION_SECRET,
  );
  await seedActiveTemplate(adminId, "email_layout", "Email layout", "{{{body_html}}}");
  await seedActiveTemplate(
    adminId,
    "meeting-guest-invitation",
    "Invitation: {{eventName}}",
    "Hi {{guestName}},\n\n[Open your meeting invitation]({{invitationUrl}})",
  );
  await seedActiveTemplate(
    adminId,
    "meeting-guest-verification-code",
    "Your meeting verification code",
    "Hi {{guestName}},\n\n{{verificationCode}}\n\nThis code expires at {{expiresAt}}.",
  );
  return { admin, series, occurrence };
}

function testEnv(): Env {
  const allow = { limit: vi.fn().mockResolvedValue({ success: true }) };
  return {
    ...env,
    APP_BASE_URL,
    INTERNAL_SIGNING_SECRET: SIGNING_SECRET,
    MEETING_PROVIDER_ENCRYPTION_KEY: ENCRYPTION_SECRET,
    SENDGRID_API_KEY: "sendgrid-test-key",
    SENDGRID_API_BASE: "https://sendgrid.test/mail/send",
    SENDGRID_FROM_EMAIL: "noreply@example.test",
    SENDGRID_FROM_NAME: "Example",
    EMAIL_RATE_LIMITER: allow,
    IP_RATE_LIMITER: allow,
  } as Env;
}

async function routeRequest(path: string, init: RequestInit = {}, envOverride: Partial<Env> = {}) {
  const pending: Promise<unknown>[] = [];
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  headers.set("cf-connecting-ip", "192.0.2.10");
  const response = await app.fetch(
    new Request(`${APP_BASE_URL}${path}`, { ...init, headers }),
    {
      ...testEnv(),
      ...envOverride,
    },
    {
      passThroughOnException: () => {},
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as any,
  );
  return { response, pending };
}

function sendgridBody(fetchMock: ReturnType<typeof vi.fn>, call: number): string {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return String(init.body);
}

function cookiePair(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]+)`));
  if (!match) throw new Error(`Missing ${name} cookie`);
  return match[1];
}

async function queuedInvitationToken(outboxId: string): Promise<string> {
  const payloadJson = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE id = ?")
    .bind(outboxId)
    .first<string>("payload_json");
  const materialized = await materializeQueuedCapabilityLinks(env.DB, testEnv(), JSON.parse(payloadJson!));
  const invitationUrl = new URL(String(materialized.invitationUrl));
  const token = new URLSearchParams(invitationUrl.hash.split("?")[1]).get("token");
  if (!token) throw new Error("Invitation token was not materialized");
  return token;
}

function afterFirstMatchingRead(
  database: DatabaseLike,
  queryFragment: string,
  action: () => Promise<void>,
): DatabaseLike {
  let invoked = false;
  const wrap = (statement: StatementLike, matches: boolean): StatementLike => ({
    bind(...values: unknown[]) {
      return wrap(statement.bind(...values), matches);
    },
    run<T>() {
      return statement.run<T>();
    },
    all<T>() {
      return statement.all<T>();
    },
    async first<T>(columnName?: string) {
      const result = await statement.first<T>(columnName);
      if (matches && !invoked) {
        invoked = true;
        await action();
      }
      return result;
    },
  });
  return {
    prepare(query: string) {
      return wrap(database.prepare(query), query.includes(queryFragment));
    },
    batch(statements: StatementLike[]) {
      return database.batch(statements);
    },
  };
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("external meeting guest invitations", () => {
  it("sends a secret-bound invitation and establishes an occurrence-scoped session through the mounted routes", async () => {
    const { admin, series, occurrence } = await fixture();
    const recipientEmail = `browser-guest-${crypto.randomUUID()}@example.test`;
    const invited = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: recipientEmail,
        name: "Browser Guest",
        affiliation: "External Organization",
        expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
      },
      APP_BASE_URL,
    );
    const stored = await env.DB.prepare("SELECT payload_json, recipient_email FROM email_outbox WHERE id = ?")
      .bind(invited.outboxId)
      .first<{ payload_json: string; recipient_email: string }>();
    expect(stored?.recipient_email).toBe(recipientEmail);
    expect(stored?.payload_json).toContain("pkcq1_");
    expect(stored?.payload_json).toContain("__authorizedCapabilityMarkers");
    const invitationSecret = await env.DB.prepare("SELECT invitation_secret FROM event_occurrence_guests WHERE id = ?")
      .bind(invited.guest.id)
      .first<string>("invitation_secret");
    expect(stored?.payload_json).not.toContain(invitationSecret!);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "meeting-guest-test" } }));
    vi.stubGlobal("fetch", fetchMock);
    await processOutboxById(env.DB, testEnv(), invited.outboxId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const invitationMessage = sendgridBody(fetchMock, 0);
    expect(invitationMessage).toContain(recipientEmail);
    expect(invitationMessage).toContain("pkc1_");
    expect(invitationMessage).not.toContain("pkcq1_");
    expect(invitationMessage).not.toContain(invitationSecret!);
    const invitationToken = invitationMessage.match(/token=(pkc1_[A-Za-z0-9_.-]+)/)?.[1];
    expect(invitationToken).toBeTruthy();

    const bootstrap = await routeRequest("/api/v1/meeting-guests/invitations/bootstrap", {
      method: "POST",
      body: JSON.stringify({ token: invitationToken, occurrenceId: occurrence.id }),
    });
    expect(bootstrap.response.status, await bootstrap.response.clone().text()).toBe(202);
    expect(bootstrap.response.headers.get("cache-control")).toContain("no-store");
    expect(bootstrap.response.headers.get("referrer-policy")).toBe("no-referrer");
    const challenge = await bootstrap.response.json<{ challengeId: string; expiresAt: string }>();
    expect(challenge).not.toHaveProperty("emailHint");
    expect(JSON.stringify(challenge)).not.toContain("example.test");
    const challengeSetCookie = bootstrap.response.headers.get("set-cookie") ?? "";
    expect(challengeSetCookie).toContain("HttpOnly");
    expect(challengeSetCookie).toContain("SameSite=Strict");
    const challengeCookie = cookiePair(challengeSetCookie, "pkic_meeting_guest_challenge");
    await Promise.all(bootstrap.pending);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const codeMessage = sendgridBody(fetchMock, 1);
    expect(codeMessage).toContain(recipientEmail);
    const verificationCode = codeMessage.match(/\b([A-HJ-NP-Z2-9]{8})\b/)?.[1];
    expect(verificationCode).toBeTruthy();

    const forwarded = await routeRequest("/api/v1/meeting-guests/invitations/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId: challenge.challengeId, code: verificationCode }),
    });
    expect(forwarded.response.status).toBe(401);

    const wrongCode = await routeRequest("/api/v1/meeting-guests/invitations/verify", {
      method: "POST",
      headers: { cookie: challengeCookie },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: "AAAAAAAA" }),
    });
    expect(wrongCode.response.status).toBe(401);

    const verified = await routeRequest("/api/v1/meeting-guests/invitations/verify", {
      method: "POST",
      headers: { cookie: challengeCookie },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: verificationCode }),
    });
    expect(verified.response.status, await verified.response.clone().text()).toBe(200);
    expect(await verified.response.json()).toMatchObject({ occurrenceId: occurrence.id });
    const sessionSetCookie = verified.response.headers.get("set-cookie") ?? "";
    expect(sessionSetCookie).toContain("pkic_meeting_guest_session=");
    expect(sessionSetCookie).toContain("pkic_meeting_guest_challenge=");
    expect(sessionSetCookie).toContain("Max-Age=0");
    const sessionCookie = cookiePair(sessionSetCookie, "pkic_meeting_guest_session");

    const landing = await routeRequest(`/api/v1/meeting-guests/meetings/occurrences/${occurrence.id}/join`, {
      headers: { cookie: sessionCookie },
    });
    expect(landing.response.status, await landing.response.clone().text()).toBe(200);
    expect(await landing.response.json()).toMatchObject({
      name: "Browser Guest",
      affiliation: "External Organization",
    });

    const replay = await routeRequest("/api/v1/meeting-guests/invitations/verify", {
      method: "POST",
      headers: { cookie: challengeCookie },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: verificationCode }),
    });
    expect(replay.response.status).toBe(409);
  });

  it("does not upgrade a signed invitation across a concurrent reinvitation", async () => {
    const { admin, series, occurrence } = await fixture();
    const input = {
      email: `rotation-race-${crypto.randomUUID()}@example.test`,
      name: "Rotation Race Guest",
      expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
    };
    const invited = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, input, APP_BASE_URL);
    const staleToken = await queuedInvitationToken(invited.outboxId);
    const racingDb = afterFirstMatchingRead(env.DB, "SELECT guest.invitation_secret AS link_secret", async () => {
      await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, input, APP_BASE_URL);
    });

    await expect(verifyMeetingGuestInvitationCapability(racingDb, staleToken, testEnv())).rejects.toMatchObject({
      status: 404,
      code: "MEETING_GUEST_INVITATION_INVALID",
    });
    expect(
      await env.DB.prepare("SELECT invitation_version FROM event_occurrence_guests WHERE id = ?")
        .bind(invited.guest.id)
        .first<number>("invitation_version"),
    ).toBe(2);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM meeting_guest_browser_challenges").first<number>("total"),
    ).toBe(0);
  });

  it("does not materialize a queued invitation after its occurrence window closes", async () => {
    const { admin, series, occurrence } = await fixture();
    const invited = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: `schedule-expired-${crypto.randomUUID()}@example.test`,
        name: "Schedule Expired Guest",
        expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
      },
      APP_BASE_URL,
    );
    await env.DB.prepare("UPDATE event_occurrences SET starts_at = ?, ends_at = ? WHERE id = ?")
      .bind(
        new Date(Date.now() - 7_200_000).toISOString(),
        new Date(Date.now() - 3_600_000).toISOString(),
        occurrence.id,
      )
      .run();

    await expect(queuedInvitationToken(invited.outboxId)).rejects.toMatchObject({
      status: 410,
      code: "CAPABILITY_RESOURCE_STALE",
    });
  });

  it("returns the documented gone response for an expired browser challenge", async () => {
    const { admin, series, occurrence } = await fixture();
    const invited = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: `expired-challenge-${crypto.randomUUID()}@example.test`,
        name: "Expired Challenge Guest",
        expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
      },
      APP_BASE_URL,
    );
    const guest = await verifyMeetingGuestInvitationCapability(
      env.DB,
      await queuedInvitationToken(invited.outboxId),
      testEnv(),
    );
    const challenge = await prepareMeetingGuestBrowserChallenge(env.DB, guest, occurrence.id);
    await challenge.statement.run();
    await env.DB.prepare("UPDATE meeting_guest_browser_challenges SET expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), challenge.challengeId)
      .run();

    const response = await routeRequest("/api/v1/meeting-guests/invitations/verify", {
      method: "POST",
      headers: {
        cookie: `pkic_meeting_guest_challenge=${encodeURIComponent(challenge.browserSecret)}`,
      },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: challenge.verificationCode }),
    });
    expect(response.response.status, await response.response.clone().text()).toBe(410);
  });

  it("makes a queued invitation stale after reinvitation instead of minting current authority", async () => {
    const { admin, series, occurrence } = await fixture();
    const email = `stale-guest-${crypto.randomUUID()}@example.test`;
    const input = {
      email,
      name: "Stale Guest",
      expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
    };
    const first = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, input, APP_BASE_URL);
    await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, input, APP_BASE_URL);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(processOutboxById(env.DB, testEnv(), first.outboxId)).rejects.toMatchObject({
      code: "CAPABILITY_RESOURCE_STALE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without rate limiting and enforces the D1 challenge throttle", async () => {
    const { admin, series, occurrence } = await fixture();
    const invited = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: `rate-limited-guest-${crypto.randomUUID()}@example.test`,
        name: "Rate Limited Guest",
        expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
      },
      APP_BASE_URL,
    );
    const token = await queuedInvitationToken(invited.outboxId);
    const request = {
      method: "POST",
      body: JSON.stringify({ token, occurrenceId: occurrence.id }),
    };

    const unavailable = await routeRequest("/api/v1/meeting-guests/invitations/bootstrap", request, {
      EMAIL_RATE_LIMITER: undefined,
    });
    expect(unavailable.response.status).toBe(503);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM meeting_guest_browser_challenges").first<number>("total"),
    ).toBe(0);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "rate-test" } })),
    );
    const first = await routeRequest("/api/v1/meeting-guests/invitations/bootstrap", request);
    expect(first.response.status).toBe(202);
    await Promise.all(first.pending);
    const repeated = await routeRequest("/api/v1/meeting-guests/invitations/bootstrap", request);
    expect(repeated.response.status).toBe(429);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM meeting_guest_browser_challenges").first<number>("total"),
    ).toBe(1);
  });

  it("rolls back guest eligibility or challenge creation when its matching outbox insert fails", async () => {
    const { admin, series, occurrence } = await fixture();
    await env.DB.prepare(
      `CREATE TRIGGER test_reject_meeting_guest_outbox
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key IN ('meeting-guest-invitation', 'meeting-guest-verification-code')
       BEGIN
         SELECT RAISE(ABORT, 'TEST_REJECT_MEETING_GUEST_OUTBOX');
       END`,
    ).run();
    try {
      await expect(
        inviteOccurrenceGuest(
          env.DB,
          admin,
          GROUP_ID,
          series.id,
          occurrence.id,
          {
            email: `atomic-guest-${crypto.randomUUID()}@example.test`,
            name: "Atomic Guest",
            expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
          },
          APP_BASE_URL,
        ),
      ).rejects.toThrow("TEST_REJECT_MEETING_GUEST_OUTBOX");
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_occurrence_guests").first<number>("total")).toBe(
        0,
      );
    } finally {
      await env.DB.prepare("DROP TRIGGER test_reject_meeting_guest_outbox").run();
    }

    const invited = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: `atomic-challenge-${crypto.randomUUID()}@example.test`,
        name: "Atomic Challenge Guest",
        expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
      },
      APP_BASE_URL,
    );
    const token = await queuedInvitationToken(invited.outboxId);

    await env.DB.prepare(
      `CREATE TRIGGER test_reject_meeting_guest_code_outbox
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'meeting-guest-verification-code'
       BEGIN
         SELECT RAISE(ABORT, 'TEST_REJECT_MEETING_GUEST_CODE_OUTBOX');
       END`,
    ).run();
    try {
      const bootstrap = await routeRequest("/api/v1/meeting-guests/invitations/bootstrap", {
        method: "POST",
        body: JSON.stringify({ token, occurrenceId: occurrence.id }),
      });
      expect(bootstrap.response.status).toBe(500);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS total FROM meeting_guest_browser_challenges").first<number>("total"),
      ).toBe(0);
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM email_outbox WHERE template_key = 'meeting-guest-verification-code'",
        ).first<number>("total"),
      ).toBe(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER test_reject_meeting_guest_code_outbox").run();
    }
  });

  it("keeps raw queued capability markers materializable only for their authorized payload field", async () => {
    const { admin, series, occurrence } = await fixture();
    const invited = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: `materialize-guest-${crypto.randomUUID()}@example.test`,
        name: "Materialize Guest",
        expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
      },
      APP_BASE_URL,
    );
    const payloadJson = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE id = ?")
      .bind(invited.outboxId)
      .first<string>("payload_json");
    const materialized = await materializeQueuedCapabilityLinks(env.DB, testEnv(), JSON.parse(payloadJson!));
    expect(materialized.invitationUrl).toContain("token=pkc1_");
    expect(JSON.stringify(materialized)).not.toContain("pkcq1_");
  });
});
