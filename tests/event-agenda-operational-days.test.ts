import { grantAdministrator } from "./helpers/administrator";
import { staffingFixture } from "./helpers/agenda-staffing";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { publishAgenda } from "../functions/_lib/services/event-agenda/mutations";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { operationalDays, operationalIntervalDays } from "../functions/_lib/services/event-agenda/operational-days";
import { eventEntryOccupiedSql } from "../functions/_lib/services/event-participation/event-entry-capacity";
const eventId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  staffId = crypto.randomUUID(),
  attendeeId = crypto.randomUUID(),
  admin = crypto.randomUUID();
const start = "2027-01-20T09:00:00.000Z",
  end = "2027-01-20T10:00:00.000Z";
async function registration(user: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
  )
    .bind(crypto.randomUUID(), eventId, user, crypto.randomUUID(), now, now)
    .run();
}
beforeEach(async () => {
  await resetDb();
  const now = new Date().toISOString();
  for (const user of [staffId, attendeeId, admin])
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(user, `${user}@example.test`, `${user}@example.test`)
      .run();
  await grantAdministrator(env.DB, admin);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,registration_mode,capacity_in_person,settings_json,created_at,updated_at) VALUES(?,'operational-days','Operational days','Europe/Amsterdam','invite_or_open',1,'{}',?,?)",
  )
    .bind(eventId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,capacity) VALUES(?,?,'Workshop',?,?,10)",
  )
    .bind(sessionId, eventId, start, end)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,NULL,?)",
  )
    .bind(eventId, now)
    .run();
});
describe("Private approved event-day operational capacity", () => {
  it("uses venue dates and half-open midnight boundaries across DST", () => {
    expect(operationalIntervalDays("2026-10-24T21:00:00.000Z", "2026-10-25T23:00:00.000Z", "Europe/Amsterdam")).toEqual(
      ["2026-10-24", "2026-10-25"],
    );
    expect(operationalIntervalDays("2026-10-25T22:00:00.000Z", "2026-10-25T23:00:00.000Z", "Europe/Amsterdam")).toEqual(
      ["2026-10-25"],
    );
    expect(operationalIntervalDays("2026-03-28T22:00:00.000Z", "2026-03-29T22:00:00.000Z", "Europe/Amsterdam")).toEqual(
      ["2026-03-28", "2026-03-29"],
    );
  });
  it("counts standalone physical MC blocks without creating registrations and deduplicates later registration", async () => {
    await env.DB.prepare(
      "INSERT INTO event_agenda_blocks(id,event_id,name,start_at,end_at,roles_json) VALUES('standalone',?,'Morning MC',?,?,'[\"mc\"]')",
    )
      .bind(eventId, "2027-01-20T07:00:00.000Z", "2027-01-20T08:00:00.000Z")
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_role_members(event_id,user_id,roles_json,attendance_mode) VALUES(?,?,'[\"mc\"]','physical')",
    )
      .bind(eventId, staffId)
      .run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO event_agenda_staffing_roles(event_id,id,name) VALUES(?,'mc','MC')").bind(eventId),
      env.DB.prepare(
        "INSERT INTO event_agenda_staffing_requirements(event_id,id,block_id,role_id,ideal_count,seniority,attendance_mode) VALUES(?,'mc-need','standalone','mc',1,'any','physical')",
      ).bind(eventId),
      env.DB.prepare(
        "INSERT INTO event_agenda_staffing_positions(event_id,id,requirement_id,position_index) VALUES(?,'mc-position','mc-need',1)",
      ).bind(eventId),
      env.DB.prepare(
        "INSERT INTO event_agenda_assignments(event_id,position_id,block_id,role,user_id,pinned) VALUES(?,'mc-position','standalone','mc',?,1)",
      ).bind(eventId, staffId),
    ]);
    await publishAgenda(env.DB, eventId, "operational-days", 0, admin);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id=?").bind(eventId).first(),
    ).toMatchObject({ count: 0 });
    const expression = eventEntryOccupiedSql(`'${eventId}'`, "'2027-01-20'");
    expect(await env.DB.prepare(`SELECT ${expression} AS occupied`).first()).toMatchObject({ occupied: 1 });
    await registration(staffId);
    expect(await env.DB.prepare(`SELECT ${expression} AS occupied`).first()).toMatchObject({ occupied: 1 });
    await env.DB.prepare("UPDATE event_agenda_role_members SET attendance_mode='remote' WHERE event_id=? AND user_id=?")
      .bind(eventId, staffId)
      .run();
    expect(
      await env.DB.prepare("SELECT day_date,user_id FROM event_agenda_operational_days WHERE event_id=? AND revision=1")
        .bind(eventId)
        .first(),
    ).toMatchObject({ day_date: "2027-01-20", user_id: staffId });
  });
  it("refuses a publication that adds a presenter beyond existing event-day capacity", async () => {
    await registration(attendeeId);
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES(?,?,'speaker')",
    )
      .bind(sessionId, staffId)
      .run();
    await seedApprovedSessionAppearances(env.DB, {
      occurrenceId: sessionId,
      reviewerId: admin,
      appearances: [
        individualAppearanceFixture({
          userId: staffId,
          displayName: "Approved workshop presenter",
          approvedAt: "2026-10-04T00:00:00.000Z",
        }),
      ],
    });
    await expect(publishAgenda(env.DB, eventId, "operational-days", 0, admin)).rejects.toMatchObject({
      code: "AGENDA_RESERVED_CAPACITY",
    });
    expect(
      await env.DB.prepare("SELECT published_revision FROM event_agenda_state WHERE event_id=?").bind(eventId).first(),
    ).toMatchObject({ published_revision: null });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_operational_days WHERE event_id=?")
        .bind(eventId)
        .first(),
    ).toMatchObject({ count: 0 });
  });
  it("excludes remote credits and staff while deduplicating physical credit and block duties", async () => {
    const snapshot = await getAgenda(env.DB, eventId, "operational-days");
    snapshot.occurrences[0]!.speakers = [
      { userId: staffId, displayName: "Physical", attendanceMode: "physical" },
      { userId: attendeeId, displayName: "Remote", attendanceMode: "remote" },
    ];
    snapshot.blocks = [
      {
        id: "block",
        name: "MC",
        startAt: start,
        endAt: end,
        roomId: null,
        roles: ["mc", "remote_qa"],
        roleRequirements: [],
      },
    ];
    snapshot.roleMembers = [
      {
        userId: staffId,
        displayName: "Physical",
        roles: ["mc"],
        attendanceMode: "physical",
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
        seniority: "senior",
      },
      {
        userId: attendeeId,
        displayName: "Remote",
        roles: ["remote_qa"],
        attendanceMode: "remote",
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
        seniority: "senior",
      },
    ];
    Object.assign(
      snapshot,
      staffingFixture({
        expectedRevision: snapshot.revision,
        blocks: snapshot.blocks,
        roleMembers: snapshot.roleMembers,
        assignments: [
          { blockId: "block", role: "mc", userId: staffId, pinned: true },
          { blockId: "block", role: "remote_qa", userId: attendeeId, pinned: true },
        ],
      }),
    );
    expect(operationalDays(snapshot)).toEqual([
      { day_date: "2027-01-20", user_id: staffId, sources: [`credit:${sessionId}:speaker`, "block:block:mc"] },
    ]);
  });
});
