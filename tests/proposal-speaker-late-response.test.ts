import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { selectIndividualSpeakerRepresentation } from "./helpers/proposal-proof";
import {
  setupProposalSpeakerCapacityWorkflow,
  inviteSpeakerAndSubmitCapacityProposal,
} from "./helpers/proposal-speaker-capacity";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { declineSpeakerParticipation } from "../functions/_lib/services/proposal-speaker-decline";
import { confirmSpeakerParticipation } from "../functions/_lib/services/proposal-speaker-confirmation";
import { speakerParticipationResponseSchema } from "../assets/shared/schemas/speaker-self-service";

const consents = [{ termKey: "speaker-terms", version: "v1" }];
const at = "2026-12-01T09:00:00.000Z";

describe("speaker willingness and late review", () => {
  let eventId: string;
  let adminUserId: string;
  let adminSessionToken: string;
  beforeEach(async () => {
    await resetDb();
    ({ eventId, adminUserId, adminSessionToken } = await setupProposalSpeakerCapacityWorkflow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });
  afterEach(() => vi.unstubAllGlobals());
  async function fixture() {
    const seeded = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents,
      speakerManagementToken: seeded.speakerManageToken,
    });
    const token = await createAdminSession(env.DB, seeded.coSpeakerUserId, crypto.randomUUID());
    return { ...seeded, token };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const respond = (f: Fixture, body: unknown = { status: "confirmed", consents }) =>
    callApi(env, `/api/v1/proposals/${f.proposalId}/participation`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${f.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const decide = (f: Fixture, decision = "approve", token = adminSessionToken) =>
    callApi(env, `/api/v1/proposals/${f.proposalId}/speakers/${f.coSpeakerUserId}/acceptance`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
  const expire = (f: Fixture) =>
    env.DB.prepare(
      "UPDATE proposal_speakers SET invite_expires_at='2020-01-01T00:00:00.000Z' WHERE proposal_id=? AND user_id=?",
    )
      .bind(f.proposalId, f.coSpeakerUserId)
      .run();
  const state = (f: Fixture) =>
    env.DB.prepare(
      "SELECT status,confirmed_at,terms_accepted_at,invite_generation,response_invite_generation FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
    )
      .bind(f.proposalId, f.coSpeakerUserId)
      .first();
  const notices = () =>
    queryAll<{ recipient_user_id: string; payload_json: string }>(
      env.DB,
      "SELECT recipient_user_id,payload_json FROM email_outbox WHERE template_key='proposal_speaker_response' ORDER BY recipient_user_id",
    );
  async function proposalState(f: Fixture) {
    const row = await env.DB.prepare("SELECT status,proposer_user_id FROM session_proposals WHERE id=?")
      .bind(f.proposalId)
      .first<{ status: string; proposer_user_id: string }>();
    return row!;
  }
  async function place(f: Fixture) {
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,source_key,start_at,end_at) VALUES (?,?,'Placed session',?,?,?)",
      ).bind(id, eventId, `proposal:${f.proposalId}`, at, "2026-12-01T10:00:00.000Z"),
      env.DB.prepare(
        "INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES (?,0,?) ON CONFLICT(event_id) DO NOTHING",
      ).bind(eventId, at),
    ]);
    return id;
  }
  it("notifies the proposer once on normal confirmation without accepting or placing the proposal", async () => {
    const f = await fixture();
    const before = await proposalState(f);
    expect((await respond(f)).status).toBe(200);
    expect(await state(f)).toMatchObject({ status: "confirmed", confirmed_at: expect.any(String) });
    expect(await proposalState(f)).toEqual(before);
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_occurrences")).toHaveLength(0);
    expect(await notices()).toEqual([expect.objectContaining({ recipient_user_id: before.proposer_user_id })]);
    expect((await respond(f)).status).toBe(200);
    expect(await notices()).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT status FROM email_outbox WHERE template_key='proposal_speaker_response'"),
    ).toEqual([{ status: "sent" }]);
  });
  it("preserves participation reservations during late review and preserves speaker consent on approval", async () => {
    const f = await fixture();
    await expire(f);
    await env.DB.prepare("UPDATE session_proposals SET status='accepted' WHERE id=?").bind(f.proposalId).run();
    const response = await respond(f);
    expect(response.status).toBe(200);
    expect(speakerParticipationResponseSchema.parse(await response.json()).status).toBe("pending");
    expect(await state(f)).toMatchObject({
      status: "pending",
      confirmed_at: null,
      terms_accepted_at: expect.any(String),
    });
    const recipients = (await notices()).map((row) => row.recipient_user_id);
    expect(recipients).toContain((await proposalState(f)).proposer_user_id);
    expect(recipients).toContain(adminUserId);
    const committeeNotice = (await notices()).find((row) => row.recipient_user_id === adminUserId)!;
    expect(JSON.parse(committeeNotice.payload_json).proposalUrl).toMatch(
      new RegExp(`/groups/[^/]+/events/${eventId}/proposals/${f.proposalId}/speakers$`),
    );
    expect((await notices()).every((row) => JSON.parse(row.payload_json).late)).toBe(true);
    expect(
      await queryAll(
        env.DB,
        "SELECT role FROM effective_event_participant_roles WHERE event_id=? AND user_id=? AND status='active'",
        [eventId, f.coSpeakerUserId],
      ),
    ).toContainEqual({ role: "speaker" });
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_occurrences")).toHaveLength(0);
    const consentBefore = await state(f);
    const count = (await notices()).length;
    expect((await respond(f)).status).toBe(200);
    expect(await notices()).toHaveLength(count);
    expect((await decide(f, "approve", f.token)).status).toBe(403);
    expect((await decide(f)).status).toBe(200);
    expect(await state(f)).toMatchObject({ status: "confirmed", confirmed_at: expect.any(String) });
    expect((await state(f))!.terms_accepted_at).toBe(consentBefore!.terms_accepted_at);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE template_key='proposal_speaker_confirmed_by_organizer'",
      ),
    ).toEqual([]);
    const [approval] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action='speaker_late_response_approved'",
    );
    expect(JSON.parse(approval!.details_json)).toMatchObject({
      acceptanceSource: { from: null, to: "speaker" },
      termsAcceptedAt: { from: null, to: consentBefore!.terms_accepted_at },
    });
    expect((await proposalState(f)).status).toBe("accepted");
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_occurrences")).toHaveLength(0);
    expect((await decide(f)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='speaker_late_response_approved'"),
    ).toHaveLength(1);
  });
  it("notifies every manager beyond the old cap, excludes scorers, and never substitutes an email for a name", async () => {
    const f = await fixture();
    const now = new Date().toISOString();
    const ids = Array.from({ length: 101 }, (_, index) => `response-manager-${String(index).padStart(3, "0")}`);
    await env.DB.batch(
      [...ids, "response-scorer"].flatMap((id) => [
        env.DB.prepare(
          "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES (?,?,?,1,?,?)",
        ).bind(id, `${id}@example.test`, `${id}@example.test`, now, now),
        env.DB.prepare(
          "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,?,'event',?,?)",
        ).bind(
          crypto.randomUUID(),
          id,
          id === "response-scorer" ? "proposals:score" : "proposals:manage",
          eventId,
          now,
        ),
      ]),
    );
    await expire(f);
    expect((await respond(f)).status).toBe(200);
    const queued = await notices();
    expect(queued.map((row) => row.recipient_user_id)).toEqual(expect.arrayContaining(ids));
    expect(queued.map((row) => row.recipient_user_id)).not.toContain("response-scorer");
    expect(queued.every((row) => !JSON.stringify(JSON.parse(row.payload_json).speakerName).includes("@"))).toBe(true);
  });
  it("refuses expired session profile edits and declines while allowing a late confirmation", async () => {
    const f = await fixture();
    await expire(f);
    const profile = await callApi(env, `/api/v1/proposals/${f.proposalId}/participation/profile`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${f.token}`, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Changed" }),
    });
    expect(profile.status).toBe(410);
    expect((await respond(f, { status: "declined" })).status).toBe(410);
    expect((await respond(f)).status).toBe(200);
  });
  it("reports a revoked decline authority as an authorization failure and rolls back", async () => {
    const f = await fixture();
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("SET status = 'declined'"),
      () =>
        env.DB.prepare("UPDATE proposal_speakers SET manage_link_secret='rotated' WHERE proposal_id=? AND user_id=?")
          .bind(f.proposalId, f.coSpeakerUserId)
          .run(),
    );
    await expect(
      declineSpeakerParticipation(raced, f.speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        reason: null,
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toMatchObject({ status: 403, code: "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED" });
    expect(await state(f)).toMatchObject({ status: "invited" });
  });
  it("preserves legacy pending roles on accepted proposals", async () => {
    const f = await fixture();
    await env.DB.batch([
      env.DB.prepare("UPDATE session_proposals SET status='accepted' WHERE id=?").bind(f.proposalId),
      env.DB.prepare(
        "UPDATE proposal_speakers SET status='pending',response_invite_generation=NULL WHERE proposal_id=? AND user_id=?",
      ).bind(f.proposalId, f.coSpeakerUserId),
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT role FROM effective_event_participant_roles WHERE event_id=? AND user_id=? AND status='active'",
        [eventId, f.coSpeakerUserId],
      ),
    ).toContainEqual({ role: "speaker" });
  });
  it("ignores unrelated agenda edits when confirming a submitted proposal", async () => {
    const f = await fixture();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES (?,0,?) ON CONFLICT(event_id) DO NOTHING",
    )
      .bind(eventId, at)
      .run();
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL LIMIT 1")
      .bind(f.coSpeakerUserId)
      .first<{ id: string }>();
    const racingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("SET response_invite_generation"),
      () => env.DB.prepare("UPDATE event_agenda_state SET revision=revision+1 WHERE event_id=?").bind(eventId).run(),
    );
    await expect(
      confirmSpeakerParticipation(
        racingDb,
        { resourceId: f.proposalId, userId: f.coSpeakerUserId, sessionId: session!.id },
        env.INTERNAL_SIGNING_SECRET!,
        { appBaseUrl: "https://app.test", consents, ip: null, userAgent: null },
      ),
    ).resolves.toMatchObject({ status: "confirmed" });
  });
  it("requires review even if an organizer extends the deadline after a late response", async () => {
    const f = await fixture();
    await expire(f);
    expect((await respond(f)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE proposal_speakers SET invite_expires_at='2026-12-01T00:00:00.000Z' WHERE proposal_id=?",
    )
      .bind(f.proposalId)
      .run();
    expect((await respond(f)).status).toBe(200);
    expect(await state(f)).toMatchObject({ status: "pending", confirmed_at: null });
  });
  it("lets organizers decline a late response atomically and retry without duplicate notices", async () => {
    const f = await fixture();
    await expire(f);
    await env.DB.prepare("UPDATE session_proposals SET status='accepted' WHERE id=?").bind(f.proposalId).run();
    await respond(f);
    expect((await decide(f, "reject")).status).toBe(200);
    expect(await state(f)).toMatchObject({ status: "declined", confirmed_at: null });
    expect(
      await queryAll(
        env.DB,
        "SELECT role FROM effective_event_participant_roles WHERE event_id=? AND user_id=? AND status='active'",
        [eventId, f.coSpeakerUserId],
      ),
    ).toEqual([]);
    const rejected = (await notices()).filter((row) => JSON.parse(row.payload_json).rejected);
    expect(rejected.map((row) => row.recipient_user_id)).toContain(f.coSpeakerUserId);
    expect(rejected.map((row) => row.recipient_user_id)).toContain((await proposalState(f)).proposer_user_id);
    expect((await decide(f, "reject")).status).toBe(200);
    expect((await notices()).filter((row) => JSON.parse(row.payload_json).rejected)).toHaveLength(rejected.length);
    expect((await decide(f)).status).toBe(409);
  });
  it("keeps expired links expired, rejects revoked sessions, and refuses a response after replacement", async () => {
    const f = await fixture();
    await expire(f);
    const link = await callApi(env, `/api/v1/proposals/speakers/access/${f.speakerManageToken}/participation`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "confirmed", consents }),
    });
    expect(link.status).toBe(410);
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.coSpeakerUserId)
      .run();
    expect((await respond(f)).status).toBe(401);
    f.token = await createAdminSession(env.DB, f.coSpeakerUserId, crypto.randomUUID());
    await respond(f);
    await env.DB.prepare(
      "UPDATE proposal_speakers SET invite_generation=invite_generation+1,manage_link_secret='replacement' WHERE proposal_id=? AND user_id=?",
    )
      .bind(f.proposalId, f.coSpeakerUserId)
      .run();
    expect((await decide(f)).status).toBe(410);
    expect((await decide(f, "reject")).status).toBe(409);
    expect(await state(f)).toMatchObject({ status: "pending", confirmed_at: null });
  });
  it.each([false, true])("rolls back the response and both notices on outbox failure (late: %s)", async (late) => {
    const f = await fixture();
    if (late) await expire(f);
    await env.DB.prepare(
      "CREATE TRIGGER fail_response_notice BEFORE INSERT ON email_outbox WHEN NEW.template_key='proposal_speaker_response' BEGIN SELECT RAISE(ABORT,'forced response notice failure'); END;",
    ).run();
    try {
      expect((await respond(f)).status).toBe(500);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_response_notice").run();
    }
    expect(await state(f)).toMatchObject({ status: "invited", confirmed_at: null });
    expect(await notices()).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action IN ('speaker_confirmed','speaker_late_response')"),
    ).toEqual([]);
  });
  it.each(["approve", "reject"])(
    "rolls back a late review decision and all notices on enqueue failure (%s)",
    async (decision) => {
      const f = await fixture();
      await expire(f);
      await respond(f);
      const before = await notices();
      await env.DB.prepare(
        "CREATE TRIGGER fail_decision_notice BEFORE INSERT ON email_outbox WHEN NEW.template_key='proposal_speaker_response' BEGIN SELECT RAISE(ABORT,'forced decision notice failure'); END;",
      ).run();
      try {
        expect((await decide(f, decision)).status).toBe(500);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_decision_notice").run();
      }
      expect(await state(f)).toMatchObject({ status: "pending", confirmed_at: null });
      expect(await notices()).toEqual(before);
      expect((await decide(f, decision)).status).toBe(200);
    },
  );
  it("refuses a stale late response if the invitation generation changes at commit", async () => {
    const f = await fixture();
    await expire(f);
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL LIMIT 1")
      .bind(f.coSpeakerUserId)
      .first<{ id: string }>();
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("SET response_invite_generation"),
      () =>
        env.DB.prepare(
          "UPDATE proposal_speakers SET invite_generation=invite_generation+1 WHERE proposal_id=? AND user_id=?",
        )
          .bind(f.proposalId, f.coSpeakerUserId)
          .run(),
    );
    await expect(
      confirmSpeakerParticipation(
        raced,
        { resourceId: f.proposalId, userId: f.coSpeakerUserId, sessionId: session!.id },
        env.INTERNAL_SIGNING_SECRET!,
        {
          appBaseUrl: "https://app.test",
          consents,
          ip: null,
          userAgent: null,
        },
      ),
    ).rejects.toMatchObject({ code: "PROPOSAL_SPEAKER_CONFLICT" });
    expect(await state(f)).toMatchObject({ status: "invited", confirmed_at: null });
    expect(await notices()).toEqual([]);
  });
  it("applies the canonical schedule guard when approving a late speaker and rolls back all effects on conflict", async () => {
    const f = await fixture();
    await expire(f);
    await respond(f);
    await env.DB.prepare("UPDATE session_proposals SET status='accepted' WHERE id=?").bind(f.proposalId).run();
    const placed = await place(f);
    const other = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES (?,?,'Other session',?,?)",
      ).bind(other, eventId, at, "2026-12-01T10:00:00.000Z"),
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES (?,?,'speaker')",
      ).bind(other, f.coSpeakerUserId),
    ]);
    expect((await decide(f)).status).toBe(409);
    expect(await state(f)).toMatchObject({ status: "pending", confirmed_at: null });
    expect(
      await queryAll(env.DB, "SELECT user_id FROM event_agenda_occurrence_speakers WHERE occurrence_id=?", [placed]),
    ).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE template_key='proposal_speaker_confirmed_by_organizer'",
      ),
    ).toEqual([]);
    await env.DB.prepare("DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=?").bind(other).run();
    expect((await decide(f)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT user_id FROM event_agenda_occurrence_speakers WHERE occurrence_id=?", [placed]),
    ).toEqual([{ user_id: f.coSpeakerUserId }]);
  });
});
