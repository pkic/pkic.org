import { createHash } from "node:crypto";
import { storedAgendaSnapshotSchema } from "../assets/shared/schemas/event-agenda-stored";
import { previewAgenda } from "../functions/_lib/services/event-agenda/preview";
import { allocateAgendaStaffingPositions } from "../assets/shared/event-agenda-staffing-positions";
import { z } from "zod";
import { staffingFixture } from "./helpers/agenda-staffing";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { saveAgendaStaffing, allocateStaffing } from "../functions/_lib/services/event-agenda/staffing";
import {
  createAgendaOccurrence,
  patchAgendaOccurrence,
  createAgendaRoom,
} from "../functions/_lib/services/event-agenda/mutations";
import {
  agendaOccurrenceCreateSchema,
  agendaShiftSchema,
  agendaRoleMemberSchema,
  agendaSpeakerSchema,
} from "../assets/shared/schemas/event-agenda";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
let eventId: string, person: string;
async function staffPeople(count: number) {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  await env.DB.batch(
    ids.map((id, index) =>
      env.DB.prepare(
        "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))",
      ).bind(id, `staff-${index}@example.test`, `staff-${index}@example.test`),
    ),
  );
  return ids.map((userId, index) =>
    agendaRoleMemberSchema.parse({
      userId,
      displayName: `Staff ${index}`,
      roles: ["mc", "questions"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: 240,
      seniority: "senior",
      attendanceMode: "physical",
    }),
  );
}
const shift = agendaShiftSchema.parse({
  id: "staffing-shift",
  name: "Opening",
  startAt: "2026-12-01T09:00:00.000Z",
  endAt: "2026-12-01T10:00:00.000Z",
  roomId: null,
  roles: ["mc", "questions"],
  compatibleRolePairs: [["mc", "questions"]],
});
function input(revision = 0) {
  return staffingFixture({
    expectedRevision: revision,
    shifts: [shift],
    roleMembers: [
      {
        userId: person,
        displayName: "Synthetic",
        roles: shift.roles,
        availableFrom: null,
        availableUntil: null,
        maxMinutes: 120,
        seniority: "senior",
        attendanceMode: "physical",
      },
    ],
    assignments: shift.roles.map((role) => ({
      shiftId: shift.id,
      role,
      userId: person,
      pinned: true,
      origin: "manual" as const,
    })),
  });
}
describe("Staffing policy persistence and review", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    person = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  });
  it("reads historical staffing names without changing approved bytes, IDs, pins or source digest", async () => {
    const saved = await saveAgendaStaffing(env.DB, eventId, "pqc-2026", input(), person);
    const legacyReference = <T extends { shiftId: string }>(entry: T) => {
      const { shiftId, ...rest } = entry;
      return { ...rest, blockId: shiftId };
    };
    const { shifts, ...original } = saved;
    const legacy = {
      ...original,
      blocks: shifts,
      approvedAt: "2026-10-07T06:00:00.000Z",
      publishedRevision: saved.revision,
      assignments: saved.assignments.map(legacyReference),
      staffingRequirements: saved.staffingRequirements.map(legacyReference),
      staffingReport: saved.staffingReport
        ? {
            ...saved.staffingReport,
            coverage: saved.staffingReport.coverage.map(legacyReference),
            uncovered: saved.staffingReport.uncovered.map(legacyReference),
            boundaryChanges: saved.staffingReport.boundaryChanges.map(legacyReference),
          }
        : undefined,
    };
    const bytes = JSON.stringify(legacy);
    const sourceDigest = createHash("sha256").update(bytes).digest("hex");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, saved.revision, bytes, person, legacy.approvedAt)
      .run();
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=? WHERE event_id=?")
      .bind(saved.revision, eventId)
      .run();
    const decoded = storedAgendaSnapshotSchema.parse(JSON.parse(bytes));
    expect(decoded.shifts).toEqual(saved.shifts);
    expect(decoded.assignments).toEqual(saved.assignments);
    expect(decoded.staffingRequirements).toEqual(saved.staffingRequirements);
    expect(decoded.staffingReport).toEqual(saved.staffingReport);
    expect(decoded).not.toHaveProperty("blocks");
    const approved = await previewAgenda(env.DB, eventId, "pqc-2026", "approved");
    expect(approved.revision).toBe(saved.revision);
    expect(approved.shifts).toEqual([]);
    expect(approved.assignments).toEqual([]);
    const persisted = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?",
    )
      .bind(eventId, saved.revision)
      .first<{ snapshot_json: string }>();
    expect(persisted?.snapshot_json).toBe(bytes);
    expect(createHash("sha256").update(persisted!.snapshot_json).digest("hex")).toBe(sourceDigest);
    expect(await getAgenda(env.DB, eventId, "pqc-2026")).toEqual({ ...saved, publishedRevision: saved.revision });
  });
  it("rejects ambiguous historical shift and assignment keys without touching the source", async () => {
    const saved = await saveAgendaStaffing(env.DB, eventId, "pqc-2026", input(), person);
    const dual = { ...saved, blocks: saved.shifts };
    const bytes = JSON.stringify(dual);
    expect(storedAgendaSnapshotSchema.safeParse(dual).success).toBe(false);
    expect(JSON.stringify(dual)).toBe(bytes);
    expect(
      storedAgendaSnapshotSchema.safeParse({
        ...saved,
        assignments: saved.assignments.map((entry) => ({ ...entry, blockId: entry.shiftId })),
      }).success,
    ).toBe(false);
    expect(await getAgenda(env.DB, eventId, "pqc-2026")).toEqual(saved);
  });
  it("persists explicitly compatible duties, pins and provenance while refusing overlap or excess workload atomically", async () => {
    const saved = await saveAgendaStaffing(env.DB, eventId, "pqc-2026", input(), person);
    expect(saved.shifts[0].compatibleRolePairs).toEqual([["mc", "questions"]]);
    expect(saved.assignments).toHaveLength(2);
    expect(saved.staffingReport?.people[0]).toMatchObject({ minutes: 120, pinnedCount: 2, manualCount: 2 });
    const incompatible = input(1);
    incompatible.shifts[0].compatibleRolePairs = [];
    await expect(saveAgendaStaffing(env.DB, eventId, "pqc-2026", incompatible, person)).rejects.toMatchObject({
      code: "AGENDA_ASSIGNMENT_OVERLAP",
    });
    const tooMuch = input(1);
    tooMuch.roleMembers[0].maxMinutes = 90;
    await expect(saveAgendaStaffing(env.DB, eventId, "pqc-2026", tooMuch, person)).rejects.toMatchObject({
      status: 409,
    });
    const regenerated = await allocateStaffing(env.DB, eventId, "pqc-2026", 1, "pinned-review", "random", person);
    expect(regenerated.assignments).toEqual(saved.assignments);
    expect(regenerated.staffingReport?.people[0].pinnedCount).toBe(2);
  });
  it("links a break boundary and reports a later schedule change for organizer review", async () => {
    const agenda = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Coffee",
        kind: "break",
        startAt: "2026-12-01T10:00:00.000Z",
        endAt: "2026-12-01T10:15:00.000Z",
        roomId: null,
      }),
      person,
    );
    const body = input(1);
    body.shifts[0].boundaries = { endOccurrenceId: agenda.occurrences[0].id };
    const saved = await saveAgendaStaffing(env.DB, eventId, "pqc-2026", body, person);
    expect(saved.staffingReport?.boundaryChanges).toEqual([]);
    const moved = await patchAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agenda.occurrences[0].id,
      { expectedRevision: 2, startAt: "2026-12-01T10:30:00.000Z", endAt: "2026-12-01T10:45:00.000Z" },
      person,
    );
    expect(moved.staffingReport?.boundaryChanges).toEqual([
      { shiftId: shift.id, boundary: "end", occurrenceId: agenda.occurrences[0].id },
    ]);
  });
  it("balances unequal multi-day parallel duties, retains senior pins, and reproduces selected-shift generation", async () => {
    const people = await staffPeople(4);
    let agenda = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      name: "Main",
      capacity: 40,
      setupMinutes: 0,
    });
    const main = agenda.rooms[0].id;
    agenda = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 1,
      name: "Parallel",
      capacity: 40,
      setupMinutes: 0,
    });
    const parallel = agenda.rooms.find((room) => room.name === "Parallel")!.id;
    const shifts = [
      {
        ...shift,
        id: "long-opening",
        roomId: main,
        endAt: "2026-12-01T10:30:00.000Z",
        compatibleRolePairs: [],
        roleRequirements: [{ role: "mc", seniority: "senior" }],
      },
      { ...shift, id: "parallel-short", roomId: parallel, endAt: "2026-12-01T09:45:00.000Z", compatibleRolePairs: [] },
      {
        ...shift,
        id: "second-day",
        roomId: main,
        startAt: "2026-12-02T09:00:00.000Z",
        endAt: "2026-12-02T10:00:00.000Z",
        compatibleRolePairs: [],
      },
    ].map((item) => agendaShiftSchema.parse(item));
    const pin = {
      shiftId: shifts[0].id,
      role: "mc",
      userId: people[0].userId,
      pinned: true,
      origin: "manual" as const,
    };
    await saveAgendaStaffing(
      env.DB,
      eventId,
      "pqc-2026",
      staffingFixture({ expectedRevision: 2, shifts, roleMembers: people, assignments: [pin] }),
      person,
    );
    const generated = await allocateStaffing(env.DB, eventId, "pqc-2026", 3, "multi-day-239", "random", person);
    expect(generated.assignments).toHaveLength(6);
    expect(generated.assignments).toContainEqual({ ...pin, positionId: `${shifts[0].id}:mc:position`, postId: null });
    // Both rooms run concurrently: nobody can cover two incompatible duties.
    const opening = generated.assignments.filter((item) => item.shiftId !== "second-day");
    expect(new Set(opening.map((item) => item.userId)).size).toBe(4);
    const minutes = generated.staffingReport!.people.map((item) => item.minutes);
    expect(minutes.reduce((total, value) => total + value, 0)).toBe(390);
    // Equal eligible pools should differ by no more than the longest indivisible duty.
    expect(Math.max(...minutes) - Math.min(...minutes)).toBeLessThanOrEqual(90);
    const repeated = await allocateStaffing(env.DB, eventId, "pqc-2026", 4, "multi-day-239", "random", person);
    expect(repeated.assignments).toEqual(generated.assignments);
    const selected = await allocateStaffing(env.DB, eventId, "pqc-2026", 5, "new-day-seed", "random", person, [
      "second-day",
    ]);
    expect(selected.assignments.filter((item) => item.shiftId !== "second-day")).toEqual(opening);
    expect(selected.assignments).toContainEqual({ ...pin, positionId: `${shifts[0].id}:mc:position`, postId: null });
  });
  it("excludes a speaking senior and persists advisory coverage shortfalls without weakening eligibility", async () => {
    const people = await staffPeople(2);
    people[1].seniority = "junior";
    const agenda = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Speaker conflict",
        startAt: shift.startAt,
        endAt: shift.endAt,
        roomId: null,
        speakerUserIds: [people[0].userId],
        speakerPlacements: { [people[0].userId]: { attendanceMode: "physical", roomId: null } },
      }),
      person,
    );
    await saveAgendaStaffing(
      env.DB,
      eventId,
      "pqc-2026",
      staffingFixture({
        expectedRevision: agenda.revision,
        shifts: [{ ...shift, compatibleRolePairs: [], roleRequirements: [{ role: "mc", seniority: "senior" }] }],
        roleMembers: people,
        assignments: [],
      }),
      person,
    );
    expect(agenda.occurrences[0].speakers).toEqual([
      expect.objectContaining({ userId: people[0].userId, attendanceMode: "physical" }),
    ]);
    const before = await getAgenda(env.DB, eventId, "pqc-2026");
    const after = await allocateStaffing(
      env.DB,
      eventId,
      "pqc-2026",
      before.revision,
      "speaker-conflict",
      "random",
      person,
    );
    expect(after.staffingReport?.uncovered).toEqual([expect.objectContaining({ shiftId: shift.id, role: "mc" })]);
    expect(after.staffingReport?.uncovered[0].eligiblePeople).toBe(0);
    expect(after.staffingReport?.uncovered[0].reasons).toEqual(
      expect.arrayContaining([
        { reason: "conflict", people: 2 },
        { reason: "experience", people: 1 },
      ]),
    );
    expect(after.assignments).toHaveLength(1);
    expect(after.assignments[0]).toMatchObject({ role: "questions", userId: people[1].userId });
    expect(after.assignments.some((assignment) => assignment.userId === people[0].userId)).toBe(false);
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE entity_id=? AND action='agenda.staffing.generated'",
    )
      .bind(eventId)
      .first<{ details_json: string }>();
    const provenance = z
      .object({
        seed: z.object({ from: z.null(), to: z.string() }),
        strategy: z.object({ from: z.null(), to: z.enum(["balanced", "random"]) }),
        speakingIntervals: z.object({
          from: z.null(),
          to: z.array(
            z.object({
              id: z.string(),
              startAt: z.string(),
              endAt: z.string(),
              roomId: z.string().nullable(),
              speakers: z.array(agendaSpeakerSchema.pick({ userId: true, attendanceMode: true, roomId: true })),
            }),
          ),
        }),
      })
      .parse(JSON.parse(audit!.details_json));
    expect(provenance.speakingIntervals.to).toEqual([
      {
        id: agenda.occurrences[0].id,
        startAt: shift.startAt,
        endAt: shift.endAt,
        roomId: null,
        speakers: [{ userId: people[0].userId, attendanceMode: "physical", roomId: null }],
      },
    ]);

    const replay = allocateAgendaStaffingPositions({
      roles: before.staffingRoles,
      posts: before.staffingPosts,
      requirements: before.staffingRequirements,
      positions: before.staffingPositions,
      shifts: before.shifts,
      members: before.roleMembers,
      assignments: before.assignments,
      travelMinutes: before.travelMinutes,
      seed: provenance.seed.to,
      strategy: provenance.strategy.to,
      occurrences: before.occurrences.map((occurrence) => {
        const interval = provenance.speakingIntervals.to.find((item) => item.id === occurrence.id);
        return interval
          ? {
              ...occurrence,
              ...interval,
              speakers: interval.speakers.map((speaker) => ({ ...speaker, displayName: speaker.userId })),
            }
          : occurrence;
      }),
    });
    expect(replay.assignments).toEqual(after.assignments);
    expect(audit!.details_json).not.toContain("Staff 0");

    const unavailable = staffingFixture({
      expectedRevision: after.revision,
      shifts: [{ ...shift, compatibleRolePairs: [] }],
      roleMembers: people.map((member) => ({ ...member, availableUntil: shift.startAt })),
      assignments: [],
    });
    const limited = await saveAgendaStaffing(env.DB, eventId, "pqc-2026", unavailable, person);
    const shortfall = await allocateStaffing(
      env.DB,
      eventId,
      "pqc-2026",
      limited.revision,
      "no-availability",
      "balanced",
      person,
    );
    expect(shortfall.staffingReport?.uncovered).toEqual(
      expect.arrayContaining(shift.roles.map((role) => expect.objectContaining({ shiftId: shift.id, role }))),
    );
    expect(shortfall.assignments).toEqual([]);
  });
});
