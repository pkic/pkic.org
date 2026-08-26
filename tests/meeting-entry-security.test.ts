import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import {
  confirmMeetingJoin,
  createGroupEventSeries,
  createSeriesOccurrence,
  getMeetingJoinLanding,
  getGroupEventSeries,
  inviteOccurrenceGuest,
  listOccurrenceAttendance,
  revokeOccurrenceGuest,
  updateGroupEventSeries,
  verifyOccurrenceAttendance,
} from "../functions/_lib/services/event-series";
import {
  deriveMeetingGuestAuthorizationHash,
  issueMeetingGuestSession,
  prepareMeetingGuestBrowserChallenge,
  verifyMeetingGuestInvitationCapability,
} from "../functions/_lib/auth/meeting-guest-challenge";
import {
  requireMeetingGuestFromRequest,
  signMeetingGuestSessionToken,
} from "../functions/_lib/auth/meeting-guest-session";
import { signCapabilityToken } from "../functions/_lib/auth/capability-links";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup, revokeResourceGroupGrant } from "../functions/_lib/services/resource-grants";
import type { AuthAdmin, DatabaseLike } from "../functions/_lib/types";
import { createMemberSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";
const SIGNING_SECRET = "meeting-entry-signing-secret";
const ENCRYPTION_SECRET = "meeting-entry-encryption-secret-000000000000000";

async function inviteTestOccurrenceGuest(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  seriesId: string,
  occurrenceId: string,
  input: Parameters<typeof inviteOccurrenceGuest>[5],
) {
  return (await inviteOccurrenceGuest(db, actor, groupId, seriesId, occurrenceId, input, "https://app.test")).guest;
}

async function fixture(options: { memberGroup?: "owner" | "shared" } = {}) {
  const adminId = await insertUser(env.DB, `meeting-security-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
  const admin: AuthAdmin = {
    identityType: "user",
    id: adminId,
    email: "meeting-security-admin@example.test",
    role: "admin",
  };

  const memberGroup =
    options.memberGroup === "shared"
      ? await createGroup(env.DB, admin, {
          typeKey: "working_group",
          name: `Meeting security shared group ${crypto.randomUUID()}`,
          visibility: "authenticated",
          eligibilityMode: "open",
        })
      : null;
  const memberGroupId = memberGroup?.id ?? GROUP_ID;

  const userId = await insertUser(env.DB, `meeting-security-member-${crypto.randomUUID()}@example.test`);
  const organizationId = await insertOrganization(env.DB, `Meeting Security Org ${crypto.randomUUID()}`);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  await addRepresentative(env.DB, memberId, userId);
  await joinGroup(env.DB, memberGroupId, {
    actorUserId: userId,
    targetUserId: userId,
    selection: { mode: "all_eligible", confirmed: true },
    source: "self_service",
    allowManaged: false,
  });

  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
    eventName: "Authenticated meeting entry",
    eventSlug: `authenticated-meeting-entry-${crypto.randomUUID()}`,
    profileKey: "meeting",
    policy: {
      registrationPolicy: "no_registration",
      memberEligibility: memberGroup ? "shared_groups" : "owner_group",
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
      providerJoinUrl: "https://meet.example.test/authenticated-room",
    },
    ENCRYPTION_SECRET,
  );
  return { admin, userId, series, occurrence, memberGroupId };
}

async function memberRequest(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    {
      ...env,
      INTERNAL_SIGNING_SECRET: SIGNING_SECRET,
      MEETING_PROVIDER_ENCRYPTION_KEY: ENCRYPTION_SECRET,
    } as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function sessionIdFor(userId: string): Promise<string> {
  const id = await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(userId)
    .first<string>("id");
  if (!id) throw new Error("member session was not created");
  return id;
}

async function verifiedGuestSession(guestId: string, occurrenceId: string) {
  const row = await env.DB.prepare(
    "SELECT invitation_secret, invitation_version FROM event_occurrence_guests WHERE id = ?",
  )
    .bind(guestId)
    .first<{ invitation_secret: string; invitation_version: number }>();
  if (!row) throw new Error("guest invitation was not created");
  const invitationToken = await signCapabilityToken({
    signingSecret: SIGNING_SECRET,
    linkSecret: row.invitation_secret,
    purpose: "meeting_guest_verify",
    resourceId: guestId,
    ttlSeconds: 3600,
  });
  const guest = await verifyMeetingGuestInvitationCapability(env.DB, invitationToken, {
    INTERNAL_SIGNING_SECRET: SIGNING_SECRET,
  });
  const challenge = await prepareMeetingGuestBrowserChallenge(env.DB, guest, occurrenceId);
  await challenge.statement.run();
  const authorizationHash = await deriveMeetingGuestAuthorizationHash({
    challengeId: challenge.challengeId,
    browserSecret: challenge.browserSecret,
    verificationCode: challenge.verificationCode,
  });
  const session = await issueMeetingGuestSession(env.DB, {
    challengeId: challenge.challengeId,
    authorizationHash,
    sessionTtlHours: 72,
  });
  const token = await signMeetingGuestSessionToken(SIGNING_SECRET, {
    guestId,
    sessionId: session.sessionId,
    authorizationHash,
    expiresAt: session.expiresAt,
  });
  const identity = await requireMeetingGuestFromRequest(
    env.DB,
    new Request("https://app.test/api/v1/meeting-guests/session", {
      headers: { authorization: `Bearer ${token}` },
    }),
    { INTERNAL_SIGNING_SECRET: SIGNING_SECRET },
  );
  return { guest, challenge, session, token, identity, invitationToken };
}

beforeEach(async () => {
  await resetDb();
});

describe("authenticated meeting entry", () => {
  it("never exposes landing identity without the exact member session", async () => {
    const { occurrence } = await fixture();
    const response = await memberRequest(null, `/api/v1/me/meetings/occurrences/${occurrence.id}/join`);
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("meeting-security-member");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("requires an explicit attend grant for shared-group member entry", async () => {
    const { admin, userId, series, occurrence, memberGroupId } = await fixture({ memberGroup: "shared" });
    const path = `/api/v1/me/meetings/occurrences/${occurrence.id}/join`;

    for (const capability of ["view", "register", "manage"] as const) {
      await grantResourceToGroup(env.DB, admin, GROUP_ID, "event", series.eventId, {
        granteeGroupId: memberGroupId,
        capability,
      });
      const response = await memberRequest(
        await createMemberSession(env.DB, userId, `shared-${capability}-${crypto.randomUUID()}`, SIGNING_SECRET),
        path,
      );
      expect(response.status, `${capability} must not authorize meeting entry`).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "MEETING_ACCESS_REVOKED" } });
      await revokeResourceGroupGrant(env.DB, admin, GROUP_ID, "event", series.eventId, {
        granteeGroupId: memberGroupId,
        capability,
      });
    }

    const memberToken = await createMemberSession(
      env.DB,
      userId,
      `shared-attend-${crypto.randomUUID()}`,
      SIGNING_SECRET,
    );
    await grantResourceToGroup(env.DB, admin, GROUP_ID, "event", series.eventId, {
      granteeGroupId: memberGroupId,
      capability: "attend",
    });
    const landingResponse = await memberRequest(memberToken, path);
    expect(landingResponse.status, await landingResponse.clone().text()).toBe(200);
    const landing = (await landingResponse.json()) as {
      landingRevision: string;
      terms: Array<{ id: string; version: string; accepted: boolean }>;
    };
    const joined = await memberRequest(memberToken, path, {
      method: "POST",
      body: JSON.stringify({
        landingRevision: landing.landingRevision,
        acceptedTerms: landing.terms.map(({ id, version }) => ({ termId: id, version })),
        intentionalJoin: true,
      }),
    });
    expect(joined.status, await joined.clone().text()).toBe(200);
    expect(await joined.json()).toMatchObject({ redirectUrl: "https://meet.example.test/authenticated-room" });

    await revokeResourceGroupGrant(env.DB, admin, GROUP_ID, "event", series.eventId, {
      granteeGroupId: memberGroupId,
      capability: "attend",
    });
    const revoked = await memberRequest(memberToken, path);
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ error: { code: "MEETING_ACCESS_REVOKED" } });
  });

  it("derives member identity from the session and records intentional re-entry separately from attendance", async () => {
    const { admin, userId, series, occurrence } = await fixture();
    const termId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_terms
         (id, event_id, audience_type, term_key, version, required, display_text, active, created_at)
       VALUES (?, ?, 'attendee', 'meeting-rules', 'v1', 1, 'Follow the meeting rules', 1, datetime('now'))`,
    )
      .bind(termId, series.eventId)
      .run();
    const token = await createMemberSession(env.DB, userId, "member-meeting-session", SIGNING_SECRET);
    const path = `/api/v1/me/meetings/occurrences/${occurrence.id}/join`;
    const landingResponse = await memberRequest(token, path);
    expect(landingResponse.status).toBe(200);
    const landing = (await landingResponse.json()) as {
      name: string;
      affiliation: string | null;
      landingRevision: string;
      terms: Array<{ id: string; version: string; accepted: boolean }>;
      occurrence: { eventName: string };
    };
    expect(landing.occurrence.eventName).toBe("Authenticated meeting entry");
    expect(landing.terms).toEqual([expect.objectContaining({ id: termId, accepted: false })]);

    const first = await memberRequest(token, path, {
      method: "POST",
      body: JSON.stringify({
        landingRevision: landing.landingRevision,
        acceptedTerms: [{ termId, version: "v1" }],
        intentionalJoin: true,
      }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ redirectUrl: "https://meet.example.test/authenticated-room" });

    const refreshed = (await (await memberRequest(token, path)).json()) as {
      landingRevision: string;
      terms: Array<{ accepted: boolean }>;
    };
    expect(refreshed.terms[0].accepted).toBe(true);
    const second = await memberRequest(token, path, {
      method: "POST",
      body: JSON.stringify({
        landingRevision: refreshed.landingRevision,
        acceptedTerms: [],
        intentionalJoin: true,
      }),
    });
    expect(second.status).toBe(200);
    const confirmation = await env.DB.prepare(
      `SELECT id, join_count, attendance_verified_at
         FROM event_occurrence_join_confirmations WHERE occurrence_id = ? AND user_id = ?`,
    )
      .bind(occurrence.id, userId)
      .first<{ id: string; join_count: number; attendance_verified_at: string | null }>();
    expect(confirmation).toMatchObject({ join_count: 2, attendance_verified_at: null });
    const attendance = await listOccurrenceAttendance(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      limit: 50,
      offset: 0,
    });
    expect(attendance.confirmations[0]).toMatchObject({ joinCount: 2, attendanceVerifiedAt: null });
    await verifyOccurrenceAttendance(env.DB, admin, GROUP_ID, series.id, occurrence.id, confirmation!.id, {
      source: "manual",
    });
    expect(
      await env.DB.prepare(
        `SELECT join_count, attendance_verified_at
           FROM event_occurrence_join_confirmations WHERE occurrence_id = ? AND user_id = ?`,
      )
        .bind(occurrence.id, userId)
        .first(),
    ).toMatchObject({ join_count: 2, attendance_verified_at: expect.any(String) });
  });

  it("rejects a stale landing revision when terms change", async () => {
    const { userId, series, occurrence } = await fixture();
    const token = await createMemberSession(env.DB, userId, "stale-landing-session", SIGNING_SECRET);
    const path = `/api/v1/me/meetings/occurrences/${occurrence.id}/join`;
    const landing = (await (await memberRequest(token, path)).json()) as { landingRevision: string };
    await env.DB.prepare(
      `INSERT INTO event_terms
         (id, event_id, audience_type, term_key, version, required, display_text, active, created_at)
       VALUES (?, ?, 'attendee', 'new-rule', 'v1', 1, 'New rule', 1, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), series.eventId)
      .run();
    const response = await memberRequest(token, path, {
      method: "POST",
      body: JSON.stringify({ landingRevision: landing.landingRevision, acceptedTerms: [], intentionalJoin: true }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "MEETING_LANDING_CHANGED" } });
  });

  it("rechecks the exact member session inside the same D1 batch", async () => {
    const { userId, occurrence } = await fixture();
    await createMemberSession(env.DB, userId, "racing-member-session", SIGNING_SECRET);
    const sessionId = await sessionIdFor(userId);
    const subject = { kind: "member" as const, userId, sessionId };
    const landing = await getMeetingJoinLanding(env.DB, occurrence.id, subject, SIGNING_SECRET);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").bind(sessionId).run(),
    );
    await expect(
      confirmMeetingJoin(
        racingDb,
        occurrence.id,
        subject,
        { landingRevision: landing.landingRevision, acceptedTerms: [], intentionalJoin: true },
        {
          encryptionSecret: ENCRYPTION_SECRET,
          revisionSecret: SIGNING_SECRET,
          evidenceSecret: SIGNING_SECRET,
          ip: null,
          userAgent: null,
        },
      ),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_CHANGED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM event_occurrence_join_confirmations WHERE occurrence_id = ?")
        .bind(occurrence.id)
        .first<number>("total"),
    ).toBe(0);
  });

  it("requires current group membership for an authenticated member", async () => {
    const { userId, occurrence } = await fixture();
    await createMemberSession(env.DB, userId, "departed-member-session", SIGNING_SECRET);
    const sessionId = await sessionIdFor(userId);
    await env.DB.prepare("UPDATE group_memberships SET left_at = joined_at WHERE group_id = ? AND user_id = ?")
      .bind(GROUP_ID, userId)
      .run();
    await expect(
      getMeetingJoinLanding(env.DB, occurrence.id, { kind: "member", userId, sessionId }, SIGNING_SECRET),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_REVOKED" });
  });

  it("rejects identity fields supplied by the browser", async () => {
    const { userId, occurrence } = await fixture();
    const token = await createMemberSession(env.DB, userId, "identity-bound-session", SIGNING_SECRET);
    const path = `/api/v1/me/meetings/occurrences/${occurrence.id}/join`;
    const landing = (await (await memberRequest(token, path)).json()) as { landingRevision: string };
    const response = await memberRequest(token, path, {
      method: "POST",
      body: JSON.stringify({
        landingRevision: landing.landingRevision,
        name: "Someone Else",
        affiliation: "Attacker Organization",
        acceptedTerms: [],
        intentionalJoin: true,
      }),
    });
    expect(response.status).toBe(400);
  });

  it("atomically rejects a newly required term introduced after the landing read", async () => {
    const { userId, series, occurrence } = await fixture();
    await createMemberSession(env.DB, userId, "term-race-session", SIGNING_SECRET);
    const sessionId = await sessionIdFor(userId);
    const subject = { kind: "member" as const, userId, sessionId };
    const landing = await getMeetingJoinLanding(env.DB, occurrence.id, subject, SIGNING_SECRET);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `INSERT INTO event_terms
           (id, event_id, audience_type, term_key, version, required, display_text, active, created_at)
         VALUES (?, ?, 'attendee', 'new-rule', 'v1', 1, 'New rule', 1, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), series.eventId)
        .run(),
    );
    await expect(
      confirmMeetingJoin(
        racingDb,
        occurrence.id,
        subject,
        { landingRevision: landing.landingRevision, acceptedTerms: [], intentionalJoin: true },
        {
          encryptionSecret: ENCRYPTION_SECRET,
          revisionSecret: SIGNING_SECRET,
          evidenceSecret: SIGNING_SECRET,
          ip: null,
          userAgent: null,
        },
      ),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_CHANGED" });
  });

  it("establishes a distinct guest session only with the matching browser secret and mailbox code", async () => {
    const { admin, series, occurrence } = await fixture();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `verified-guest-${crypto.randomUUID()}@example.test`,
      name: "Verified Guest",
      affiliation: "Guest Organization",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
      seriesWide: true,
    });
    const verified = await verifiedGuestSession(guest.id, occurrence.id);
    expect(verified.identity).toMatchObject({ guestId: guest.id, name: "Verified Guest" });

    const subject = { kind: "guest" as const, guestId: guest.id, sessionId: verified.session.sessionId };
    const landing = await getMeetingJoinLanding(env.DB, occurrence.id, subject, SIGNING_SECRET);
    expect(landing).toMatchObject({ name: "Verified Guest", affiliation: "Guest Organization" });
    const result = await confirmMeetingJoin(
      env.DB,
      occurrence.id,
      subject,
      { landingRevision: landing.landingRevision, acceptedTerms: [], intentionalJoin: true },
      {
        encryptionSecret: ENCRYPTION_SECRET,
        revisionSecret: SIGNING_SECRET,
        evidenceSecret: SIGNING_SECRET,
        ip: null,
        userAgent: null,
      },
    );
    expect(result.redirectUrl).toBe("https://meet.example.test/authenticated-room");
    expect(
      await env.DB.prepare("SELECT guest_id, user_id FROM event_occurrence_join_confirmations WHERE occurrence_id = ?")
        .bind(occurrence.id)
        .first(),
    ).toEqual({ guest_id: guest.id, user_id: null });
  });

  it("rejects a forwarded invitation when the second mailbox code is unavailable", async () => {
    const { admin, series, occurrence } = await fixture();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `forwarded-${crypto.randomUUID()}@example.test`,
      name: "Forwarded Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const secret = await env.DB.prepare("SELECT invitation_secret FROM event_occurrence_guests WHERE id = ?")
      .bind(guest.id)
      .first<string>("invitation_secret");
    const token = await signCapabilityToken({
      signingSecret: SIGNING_SECRET,
      linkSecret: secret!,
      purpose: "meeting_guest_verify",
      resourceId: guest.id,
      ttlSeconds: 3600,
    });
    const invitation = await verifyMeetingGuestInvitationCapability(env.DB, token, {
      INTERNAL_SIGNING_SECRET: SIGNING_SECRET,
    });
    const challenge = await prepareMeetingGuestBrowserChallenge(env.DB, invitation, occurrence.id);
    await challenge.statement.run();
    const attackerHash = await deriveMeetingGuestAuthorizationHash({
      challengeId: challenge.challengeId,
      browserSecret: challenge.browserSecret,
      verificationCode: "AAAAAAAA",
    });
    await expect(
      issueMeetingGuestSession(env.DB, {
        challengeId: challenge.challengeId,
        authorizationHash: attackerHash,
        sessionTtlHours: 72,
      }),
    ).rejects.toMatchObject({ code: "MEETING_GUEST_CHALLENGE_INVALID" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM meeting_guest_sessions WHERE guest_id = ?")
        .bind(guest.id)
        .first<number>("total"),
    ).toBe(0);
  });

  it("mounts guest entry behind the exact verified occurrence session", async () => {
    const { admin, series, occurrence } = await fixture();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `route-guest-${crypto.randomUUID()}@example.test`,
      name: "Route Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
      seriesWide: true,
    });
    const verified = await verifiedGuestSession(guest.id, occurrence.id);
    const landingResponse = await memberRequest(
      verified.token,
      `/api/v1/meeting-guests/meetings/occurrences/${occurrence.id}/join`,
    );
    expect(landingResponse.status).toBe(200);
    const landing = (await landingResponse.json()) as { landingRevision: string };

    const joinResponse = await memberRequest(
      verified.token,
      `/api/v1/meeting-guests/meetings/occurrences/${occurrence.id}/join`,
      {
        method: "POST",
        body: JSON.stringify({
          landingRevision: landing.landingRevision,
          acceptedTerms: [],
          intentionalJoin: true,
        }),
      },
    );
    expect(joinResponse.status).toBe(200);
    expect(await joinResponse.json()).toMatchObject({ redirectUrl: "https://meet.example.test/authenticated-room" });

    const secondOccurrence = await createSeriesOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      {
        startsAt: new Date(Date.now() + 10_800_000).toISOString(),
        endsAt: new Date(Date.now() + 14_400_000).toISOString(),
        providerJoinUrl: "https://meet.example.test/other-room",
      },
      ENCRYPTION_SECRET,
    );
    const wrongOccurrence = await memberRequest(
      verified.token,
      `/api/v1/meeting-guests/meetings/occurrences/${secondOccurrence.id}/join`,
    );
    expect(wrongOccurrence.status).toBe(403);
    expect(await wrongOccurrence.json()).toMatchObject({
      error: { code: "MEETING_GUEST_OCCURRENCE_FORBIDDEN" },
    });
  });

  it("allows only one guest session per browser challenge", async () => {
    const { admin, series, occurrence } = await fixture();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `replay-${crypto.randomUUID()}@example.test`,
      name: "Replay Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const verified = await verifiedGuestSession(guest.id, occurrence.id);
    await expect(
      issueMeetingGuestSession(env.DB, {
        challengeId: verified.challenge.challengeId,
        authorizationHash: verified.challenge.authorizationHash,
        sessionTtlHours: 72,
      }),
    ).rejects.toMatchObject({ code: "MEETING_GUEST_CHALLENGE_USED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM meeting_guest_sessions WHERE guest_id = ?")
        .bind(guest.id)
        .first<number>("total"),
    ).toBe(1);
  });

  it("revokes guest sessions and pending challenges with the invitation", async () => {
    const { admin, series, occurrence } = await fixture();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `revoked-${crypto.randomUUID()}@example.test`,
      name: "Revoked Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
      seriesWide: true,
    });
    const verified = await verifiedGuestSession(guest.id, occurrence.id);
    await revokeOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, guest.id);
    await expect(
      requireMeetingGuestFromRequest(
        env.DB,
        new Request("https://app.test/api/v1/meeting-guests/session", {
          headers: { authorization: `Bearer ${verified.token}` },
        }),
        { INTERNAL_SIGNING_SECRET: SIGNING_SECRET },
      ),
    ).rejects.toMatchObject({ code: "AUTH_REVOKED" });
    await expect(
      getMeetingJoinLanding(
        env.DB,
        occurrence.id,
        { kind: "guest", guestId: guest.id, sessionId: verified.session.sessionId },
        SIGNING_SECRET,
      ),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_REVOKED" });
  });

  it("makes guest policy and active owner-group state authoritative", async () => {
    const { admin, userId, series, occurrence } = await fixture();
    await createMemberSession(env.DB, userId, "inactive-owner-session", SIGNING_SECRET);
    const memberSessionId = await sessionIdFor(userId);
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `policy-${crypto.randomUUID()}@example.test`,
      name: "Policy Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const verified = await verifiedGuestSession(guest.id, occurrence.id);
    const guestSubject = { kind: "guest" as const, guestId: guest.id, sessionId: verified.session.sessionId };
    expect((await getMeetingJoinLanding(env.DB, occurrence.id, guestSubject, SIGNING_SECRET)).name).toBe(
      "Policy Guest",
    );

    await updateGroupEventSeries(env.DB, admin, GROUP_ID, series.id, {
      expectedUpdatedAt: (await getGroupEventSeries(env.DB, GROUP_ID, series.id)).updatedAt,
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "none",
      },
    });
    await expect(getMeetingJoinLanding(env.DB, occurrence.id, guestSubject, SIGNING_SECRET)).rejects.toMatchObject({
      code: "MEETING_ACCESS_REVOKED",
    });

    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(GROUP_ID).run();
    try {
      await expect(
        getMeetingJoinLanding(
          env.DB,
          occurrence.id,
          { kind: "member", userId, sessionId: memberSessionId },
          SIGNING_SECRET,
        ),
      ).rejects.toMatchObject({ code: "MEETING_ACCESS_REVOKED" });
    } finally {
      await env.DB.prepare("UPDATE groups SET active = 1 WHERE id = ?").bind(GROUP_ID).run();
    }
  });

  it("keeps legacy guest policy rows readable through the canonical policy", async () => {
    const { admin, series, occurrence } = await fixture();
    await env.DB.prepare("UPDATE events SET settings_json = ? WHERE id = ?")
      .bind(JSON.stringify({ memberEligibility: "group", guestPolicy: "invitation_only" }), series.eventId)
      .run();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `legacy-${crypto.randomUUID()}@example.test`,
      name: "Legacy Policy Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const verified = await verifiedGuestSession(guest.id, occurrence.id);
    expect(
      await getMeetingJoinLanding(
        env.DB,
        occurrence.id,
        { kind: "guest", guestId: guest.id, sessionId: verified.session.sessionId },
        SIGNING_SECRET,
      ),
    ).toMatchObject({ name: "Legacy Policy Guest" });
  });

  it("rejects stale invitation updates and challenge issuance after revocation", async () => {
    const { admin, series, occurrence } = await fixture();
    const email = `race-${crypto.randomUUID()}@example.test`;
    const expiresAt = new Date(Date.now() + 10_800_000).toISOString();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email,
      name: "Original Guest",
      expiresAt,
    });
    const racingUpdateDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_occurrence_guests SET updated_at = ? WHERE id = ?")
        .bind("2099-01-01T00:00:00.000Z", guest.id)
        .run(),
    );
    await expect(
      inviteTestOccurrenceGuest(racingUpdateDb, admin, GROUP_ID, series.id, occurrence.id, {
        email,
        name: "Stale Overwrite",
        expiresAt,
      }),
    ).rejects.toMatchObject({ code: "EVENT_GUEST_CHANGED" });

    const row = await env.DB.prepare("SELECT invitation_secret FROM event_occurrence_guests WHERE id = ?")
      .bind(guest.id)
      .first<string>("invitation_secret");
    const token = await signCapabilityToken({
      signingSecret: SIGNING_SECRET,
      linkSecret: row!,
      purpose: "meeting_guest_verify",
      resourceId: guest.id,
      ttlSeconds: 3600,
    });
    const invitation = await verifyMeetingGuestInvitationCapability(env.DB, token, {
      INTERNAL_SIGNING_SECRET: SIGNING_SECRET,
    });
    const challenge = await prepareMeetingGuestBrowserChallenge(env.DB, invitation, occurrence.id);
    await revokeOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, guest.id);
    await expect(challenge.statement.run()).rejects.toThrow("MEETING_GUEST_CHALLENGE_CONTEXT_CHANGED");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM meeting_guest_browser_challenges WHERE guest_id = ?")
        .bind(guest.id)
        .first<number>("total"),
    ).toBe(0);
  });

  it("keeps eligibility lookups indexed for member and guest entry", async () => {
    const { userId, occurrence, admin, series } = await fixture();
    const guest = await inviteTestOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `plan-${crypto.randomUUID()}@example.test`,
      name: "Plan Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const guestPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT 1 FROM current_event_occurrence_subject_eligibility
        WHERE occurrence_id = ? AND user_id IS NULL AND guest_id = ? LIMIT 1`,
    )
      .bind(occurrence.id, guest.id)
      .all<{ detail: string }>();
    const memberPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT 1 FROM current_event_occurrence_subject_eligibility
        WHERE occurrence_id = ? AND user_id = ? AND guest_id IS NULL LIMIT 1`,
    )
      .bind(occurrence.id, userId)
      .all<{ detail: string }>();
    const guestText = guestPlan.results.map((row) => row.detail).join("\n");
    const memberText = memberPlan.results.map((row) => row.detail).join("\n");
    expect(guestText).toContain("SEARCH occurrence");
    expect(guestText).toContain("SEARCH guest");
    expect(guestText).not.toContain("SCAN guest");
    expect(memberText).toContain("SEARCH active_user");
    expect(memberText).not.toContain("SCAN active_user");
  });

  it("records service-authored guest invitations in the canonical audit log", async () => {
    const { series, occurrence } = await fixture();
    const service: AuthAdmin = {
      identityType: "service",
      id: "meeting-invitation-service",
      email: "meeting-invitation-service@internal.invalid",
      role: "admin",
    };
    const guest = await inviteTestOccurrenceGuest(env.DB, service, GROUP_ID, series.id, occurrence.id, {
      email: `service-${crypto.randomUUID()}@example.test`,
      name: "Service Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    expect(
      await env.DB.prepare(
        `SELECT actor_id FROM audit_log
          WHERE action = 'event_guest_invited' AND entity_id = ? AND scope_type = 'group' AND scope_id = ?`,
      )
        .bind(guest.id, GROUP_ID)
        .first<string>("actor_id"),
    ).toBe(service.id);
  });

  it("does not mount the former bearer-token route", async () => {
    const response = await memberRequest(null, "/api/v1/meetings/join/forwarded-secret");
    expect(response.status).toBe(404);
  });
});
