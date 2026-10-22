import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { prepareUserSession } from "../functions/_lib/auth/user-session";
import { prepareMonthlyActivity, recordMonthlyActivity } from "../functions/_lib/services/member-standing/activity";
import {
  prepareEventSpeakingStanding,
  reconcileEventSpeakingStanding,
} from "../functions/_lib/services/member-standing/event-speaking";
import { commitAgendaRevision } from "../functions/_lib/services/event-agenda/revision";
import { seedEventAndAdmin } from "./helpers/context";
import { prepareStandingAwards } from "../functions/_lib/services/member-standing/awards";
import { awardCompletedChairTerms } from "../functions/_lib/services/member-standing/chair-terms";
import { getMemberStanding } from "../functions/_lib/services/member-profile";
import { memberStandingSchema, standingSettingsSchema } from "../assets/shared/schemas/member-profile";
import { STANDING_REASON_POINTS } from "../assets/shared/member-standing";
import { insertUser } from "./helpers/membership";
import { seedPersona } from "./personas/seed";
import { resetDb } from "./helpers/reset-db";

const at = "2026-10-17T10:00:00.000Z";
let userId: string;

beforeEach(async () => {
  await resetDb();
  userId = await insertUser(env.DB);
  await env.DB.prepare("UPDATE standing_settings SET activity_started_at=?").bind("2026-01-01T00:00:00.000Z").run();
});

function award(reason: keyof typeof STANDING_REASON_POINTS, date = at, ref: string = reason) {
  return prepareStandingAwards(
    env.DB,
    reason,
    "synthetic_activity",
    {
      sql: "SELECT ? AS user_id, ? AS source_ref, ? AS awarded_at",
      bindings: [userId, ref, date],
    },
    at,
  );
}

async function ledgerCount() {
  return (await env.DB.prepare("SELECT COUNT(*) AS count FROM user_standing_awards WHERE user_id=?")
    .bind(userId)
    .first<{ count: number }>())!.count;
}

describe("atomic standing ledger", () => {
  it.each(Object.entries(STANDING_REASON_POINTS))(
    "awards %s at its canonical value and ignores retries",
    async (reason, points) => {
      const command = award(reason as keyof typeof STANDING_REASON_POINTS);
      await env.DB.batch([command]);
      await env.DB.batch([command]);
      expect(await ledgerCount()).toBe(1);
      expect((await getMemberStanding(env.DB, userId, at)).points).toBe(points);
    },
  );

  it("rolls back awards and session creation when the caller command fails", async () => {
    const prepared = await prepareUserSession(env.DB, userId, 24);
    await expect(
      env.DB.batch([
        ...prepared.statements,
        env.DB.prepare(
          "INSERT INTO user_standing_awards (id,user_id,reason_key,points,awarded_at,created_at) VALUES ('bad','missing','correction',-1,?,?)",
        ).bind(at, at),
      ]),
    ).rejects.toThrow();
    expect(await ledgerCount()).toBe(0);
    expect(await env.DB.prepare("SELECT id FROM sessions WHERE id=?").bind(prepared.sessionId).first()).toBeNull();
  });

  it("caps sign-in and refresh at one per UTC calendar month across sessions", async () => {
    const first = await prepareUserSession(env.DB, userId, 24 * 100);
    const second = await prepareUserSession(env.DB, userId, 24 * 100);
    await env.DB.batch([...first.statements, ...second.statements]);
    // The fixture's explicit session covers both sides of this month's UTC boundary.
    await env.DB.prepare("UPDATE sessions SET expires_at='2027-01-01T00:00:00.000Z' WHERE user_id=?")
      .bind(userId)
      .run();
    await env.DB.prepare("DELETE FROM user_standing_awards WHERE user_id=?").bind(userId).run();
    await env.DB.batch([
      prepareMonthlyActivity(env.DB, userId, first.sessionId, "2026-09-30T23:59:59.999Z"),
      prepareMonthlyActivity(env.DB, userId, second.sessionId, "2026-10-01T00:00:00.000Z"),
      prepareMonthlyActivity(env.DB, userId, first.sessionId, at),
    ]);
    expect(await ledgerCount()).toBe(2);
    const standing = memberStandingSchema.parse(await getMemberStanding(env.DB, userId, at));
    expect(standing.points).toBe(4);
    expect(standing.lastActiveAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("keeps concurrent refresh awards idempotent across the UTC month boundary", async () => {
    const session = await prepareUserSession(env.DB, userId, 24);
    await env.DB.batch(session.statements);
    await env.DB.prepare("UPDATE sessions SET expires_at='2027-01-01T00:00:00.000Z' WHERE id=?")
      .bind(session.sessionId)
      .run();
    await env.DB.prepare("DELETE FROM user_standing_awards WHERE user_id=?").bind(userId).run();
    for (const month of ["2026-09-30T23:59:59.999Z", "2026-10-01T00:00:00.000Z"]) {
      await Promise.all([
        recordMonthlyActivity(env.DB, userId, session.sessionId, month),
        recordMonthlyActivity(env.DB, userId, session.sessionId, month),
      ]);
    }
    expect(await ledgerCount()).toBe(2);
  });

  it("does not award expired, revoked, wrong-owner or disabled-account sessions", async () => {
    const session = await prepareUserSession(env.DB, userId, 24);
    await env.DB.batch(session.statements);
    await env.DB.prepare("DELETE FROM user_standing_awards WHERE user_id=?").bind(userId).run();
    await env.DB.batch([prepareMonthlyActivity(env.DB, userId, session.sessionId, "2099-01-01T00:00:00.000Z")]);
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(at, session.sessionId).run();
    await env.DB.batch([prepareMonthlyActivity(env.DB, userId, session.sessionId, at)]);
    await env.DB.prepare("UPDATE sessions SET revoked_at=NULL WHERE id=?").bind(session.sessionId).run();
    await env.DB.batch([prepareMonthlyActivity(env.DB, await insertUser(env.DB), session.sessionId, at)]);
    await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(userId).run();
    await env.DB.batch([prepareMonthlyActivity(env.DB, userId, session.sessionId, at)]);
    expect(await ledgerCount()).toBe(0);
  });

  it("does not backfill activity predating activation", async () => {
    await env.DB.batch([award("event_attended", "2025-12-31T23:59:59.999Z")]);
    expect(await ledgerCount()).toBe(0);
  });
});

describe("rolling standing read model", () => {
  it("uses the configured calendar-month window, includes its boundary and negative corrections, and preserves old rows", async () => {
    await env.DB.prepare("UPDATE standing_settings SET window_months=1").run();
    await env.DB.batch([
      award("event_attended", "2026-09-17T09:59:59.999Z", "expired"),
      award("event_attended", "2026-09-17T10:00:00.000Z", "boundary"),
      award("meeting_attended", at),
      award("document_reviewed", "2026-10-18T10:00:00.000Z", "future"),
      env.DB.prepare(
        "INSERT INTO user_standing_awards (id,user_id,reason_key,points,awarded_at,created_at) VALUES ('correction',?,'correction',-3,?,?)",
      ).bind(userId, at, at),
    ]);
    expect((await getMemberStanding(env.DB, userId, at)).points).toBe(12);
    expect(await ledgerCount()).toBe(5);
    await env.DB.prepare("UPDATE standing_settings SET window_months=2").run();
    expect((await getMemberStanding(env.DB, userId, at)).points).toBe(22);
  });

  it("clamps month-end windows to the last calendar day", async () => {
    await env.DB.prepare("UPDATE standing_settings SET window_months=1").run();
    await env.DB.batch([award("event_attended", "2026-02-28T10:00:00.000Z")]);
    expect((await getMemberStanding(env.DB, userId, "2026-03-31T10:00:00.000Z")).points).toBe(10);
  });

  it("returns an empty standing and retains recognitions independently of the window", async () => {
    await env.DB.prepare(
      "INSERT INTO user_recognitions (id,user_id,recognition_key,label,awarded_at,created_at,updated_at) VALUES ('r',?,'founder','Founder','2020-01-01T00:00:00.000Z',?,?)",
    )
      .bind(userId, at, at)
      .run();
    const standing = memberStandingSchema.parse(await getMemberStanding(env.DB, userId, at));
    expect(standing.points).toBe(0);
    expect(standing.lastActiveAt).toBeNull();
    expect(standing.recognitions).toHaveLength(1);
    expect(standingSettingsSchema.safeParse({ windowMonths: 0, activityStartedAt: at }).success).toBe(false);
  });
});

describe("completed chair terms", () => {
  it("bounds passes and awards completed terms once, excluding old and future terms", async () => {
    for (let i = 0; i < 4; i++) {
      const leader = await seedPersona(env.DB, "groupLead", { groupId: "20000000-0000-4000-8000-000000000001" });
      await env.DB.prepare(`UPDATE user_roles SET starts_at='2025-01-01T00:00:00.000Z', expires_at=?, revoked_at=?
        WHERE user_id=? AND role_id='role-group_lead'`)
        .bind(
          i === 0
            ? "2026-09-30T10:00:00.000Z"
            : i === 1
              ? "2025-12-31T10:00:00.000Z"
              : i === 2
                ? "2027-01-01T00:00:00.000Z"
                : at,
          i === 3 ? at : null,
          leader.userId,
        )
        .run();
    }
    await awardCompletedChairTerms(env.DB, at, 1);
    await awardCompletedChairTerms(env.DB, at, 1);
    const rows = await env.DB.prepare(
      "SELECT points,awarded_at FROM user_standing_awards WHERE reason_key='group_chaired_term'",
    ).all();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.map((row) => row.points)).toEqual([150, 150]);
  });
});

describe("agenda speaking standing", () => {
  let eventId: string;
  let occurrenceId: string;
  const endedAt = "2026-10-16T17:00:00.000Z";

  beforeEach(async () => {
    ({ eventId } = await seedEventAndAdmin(env.DB));
    occurrenceId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE events SET starts_at='2026-10-16T08:00:00.000Z',ends_at=?,updated_at=? WHERE id=?").bind(
        endedAt,
        at,
        eventId,
      ),
      env.DB.prepare("INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES (?,0,?)").bind(eventId, at),
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES (?,?,'Synthetic talk','2026-10-16T10:00:00.000Z','2026-10-16T11:00:00.000Z')",
      ).bind(occurrenceId, eventId),
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES (?,?,'speaker')",
      ).bind(occurrenceId, userId),
    ]);
  });

  async function speakingLedger() {
    return (
      await env.DB.prepare(
        "SELECT reason_key,points,awarded_at FROM user_standing_awards WHERE user_id=? ORDER BY created_at,id",
      )
        .bind(userId)
        .all<{ reason_key: string; points: number; awarded_at: string }>()
    ).results;
  }

  it("awards at the event end, once per occurrence, with no historical backfill", async () => {
    await reconcileEventSpeakingStanding(env.DB, "2026-10-16T16:59:59.999Z");
    expect(await speakingLedger()).toEqual([]);
    await reconcileEventSpeakingStanding(env.DB, endedAt);
    await reconcileEventSpeakingStanding(env.DB, at);
    expect(await speakingLedger()).toEqual([{ reason_key: "event_spoke", points: 40, awarded_at: endedAt }]);
    await env.DB.prepare("DELETE FROM user_standing_awards WHERE user_id=?").bind(userId).run();
    await env.DB.prepare("UPDATE standing_settings SET activity_started_at=?").bind(at).run();
    await reconcileEventSpeakingStanding(env.DB, at);
    expect(await speakingLedger()).toEqual([]);
  });

  it.each(["proposer", "break", "placeholder", "unscheduled"])("does not award %s credits", async (condition) => {
    if (condition === "proposer")
      await env.DB.prepare("UPDATE event_agenda_occurrence_speakers SET role='proposer' WHERE occurrence_id=?")
        .bind(occurrenceId)
        .run();
    if (condition === "break")
      await env.DB.prepare("UPDATE event_agenda_occurrences SET kind='break' WHERE id=?").bind(occurrenceId).run();
    if (condition === "placeholder")
      await env.DB.prepare("UPDATE event_agenda_occurrences SET placeholder=1 WHERE id=?").bind(occurrenceId).run();
    if (condition === "unscheduled")
      await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=NULL,end_at=NULL WHERE id=?")
        .bind(occurrenceId)
        .run();
    await reconcileEventSpeakingStanding(env.DB, at);
    expect(await speakingLedger()).toEqual([]);
  });

  it("corrects removal and reinstatement inside the agenda command without erasing its ledger", async () => {
    await reconcileEventSpeakingStanding(env.DB, at);
    await commitAgendaRevision(env.DB, eventId, 0, [
      env.DB.prepare("DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?").bind(
        occurrenceId,
        userId,
      ),
    ]);
    expect((await speakingLedger()).map((row) => row.points).sort((a, b) => a - b)).toEqual([-40, 40]);
    expect((await speakingLedger()).every((row) => row.awarded_at === endedAt)).toBe(true);
    await commitAgendaRevision(env.DB, eventId, 1, [
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES (?,?,'speaker')",
      ).bind(occurrenceId, userId),
    ]);
    await reconcileEventSpeakingStanding(env.DB, at);
    const ledger = await speakingLedger();
    expect(ledger).toHaveLength(3);
    expect(ledger.reduce((sum, row) => sum + row.points, 0)).toBe(40);
  });

  it("keeps manual negative corrections independent of automatic reconciliation", async () => {
    await reconcileEventSpeakingStanding(env.DB, at);
    await env.DB.prepare(
      "INSERT INTO user_standing_awards(id,user_id,reason_key,points,awarded_at,created_at) VALUES (?,?,'correction',-5,?,?)",
    )
      .bind(crypto.randomUUID(), userId, endedAt, at)
      .run();
    await reconcileEventSpeakingStanding(env.DB, at);
    expect((await speakingLedger()).reduce((sum, row) => sum + row.points, 0)).toBe(35);
  });

  it("moves effective dates through compensating entries when the event end changes", async () => {
    await reconcileEventSpeakingStanding(env.DB, at);
    const laterEnd = "2026-10-16T18:00:00.000Z";
    await env.DB.prepare("UPDATE events SET ends_at=?,updated_at='2026-10-17T10:01:00.000Z' WHERE id=?")
      .bind(laterEnd, eventId)
      .run();
    await reconcileEventSpeakingStanding(env.DB, at);
    const ledger = await speakingLedger();
    expect(ledger.filter((row) => row.awarded_at === endedAt).reduce((sum, row) => sum + row.points, 0)).toBe(0);
    expect(ledger.filter((row) => row.awarded_at === laterEnd).reduce((sum, row) => sum + row.points, 0)).toBe(40);
  });

  it("bounds each sweep and makes progress on the next pass", async () => {
    const second = await insertUser(env.DB);
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES (?,?,'speaker')",
    )
      .bind(occurrenceId, second)
      .run();
    await reconcileEventSpeakingStanding(env.DB, at, 1);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM standing_agenda_awards").first<{ count: number }>())?.count,
    ).toBe(1);
    await reconcileEventSpeakingStanding(env.DB, at, 1);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM standing_agenda_awards").first<{ count: number }>())?.count,
    ).toBe(2);
  });

  it("rolls back awards and source links with the activity command", async () => {
    await expect(
      env.DB.batch([
        ...prepareEventSpeakingStanding(env.DB, at),
        env.DB.prepare(
          "INSERT INTO user_standing_awards(id,user_id,reason_key,points,awarded_at,created_at) VALUES ('bad','missing','correction',-1,?,?)",
        ).bind(at, at),
      ]),
    ).rejects.toThrow();
    expect(await speakingLedger()).toEqual([]);
    expect(await env.DB.prepare("SELECT award_id FROM standing_agenda_awards LIMIT 1").first()).toBeNull();
  });
});
