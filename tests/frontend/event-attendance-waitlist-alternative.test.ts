import { describe, expect, it } from "vitest";
import {
  eventDayInputSchema,
  eventDaysManagementResponseSchema,
} from "../../assets/shared/schemas/event-configuration";
import {
  attendanceConfiguration,
  attendanceSettingsDraft,
  removeAttendanceDefinition,
  updateAttendanceDefinition,
} from "../../assets/ts/member-flows/portal/sections/management/event-attendance-draft";

const inPerson = { value: "in_person", label: "In person", capacity: 1, waitlistAlternative: "lounge" };
const lounge = { value: "lounge", label: "Livestream Lounge", accessMode: "physical" as const, capacity: 50 };

function response(days: Array<{ date: string; options: unknown[] }>) {
  return eventDaysManagementResponseSchema.parse({
    eventUpdatedAt: "2026-11-01T00:00:00.000Z",
    days: days.map((day, index) => ({
      id: `day-${index + 1}`,
      date: day.date,
      label: null,
      startsAt: null,
      endsAt: null,
      sortOrder: index * 10,
      attendanceOptions: day.options,
      attendanceCounts: {},
    })),
  });
}

describe("waitlist alternative", () => {
  it("accepts only another option of the same day", () => {
    const day = { date: "2026-12-01", attendanceOptions: [inPerson, lounge] };
    expect(eventDayInputSchema.safeParse(day).success).toBe(true);
    const remote = eventDayInputSchema.safeParse({
      ...day,
      attendanceOptions: [inPerson, { ...lounge, accessMode: "remote", waitlistAlternative: "in_person" }],
    });
    expect(remote.error?.issues).toMatchObject([{ path: ["attendanceOptions", 1, "waitlistAlternative"] }]);
    for (const waitlistAlternative of ["in_person", "virtual"]) {
      const result = eventDayInputSchema.safeParse({
        ...day,
        attendanceOptions: [{ ...inPerson, waitlistAlternative }, lounge],
      });
      expect(result.error?.issues).toMatchObject([{ path: ["attendanceOptions", 0, "waitlistAlternative"] }]);
    }
  });

  it("keeps the alternative across days and names it only on days that offer it", () => {
    const draft = attendanceSettingsDraft(
      response([
        { date: "2026-12-01", options: [{ value: "in_person", label: "In person", capacity: 1 }] },
        { date: "2026-12-02", options: [inPerson, lounge] },
      ]),
      "Europe/Amsterdam",
    );
    expect(draft.definitions[0].option.waitlistAlternative).toBe("lounge");
    const days = attendanceConfiguration(draft).days;
    expect(days[0].attendanceOptions[0]).not.toHaveProperty("waitlistAlternative");
    expect(days[1].attendanceOptions[0]).toMatchObject({ waitlistAlternative: "lounge" });
    expect(days.every((day) => eventDayInputSchema.safeParse(day).success)).toBe(true);
  });

  it("keeps each day's own alternative until the organizer chooses one", () => {
    const named = { date: "2026-12-02", options: [inPerson, lounge] };
    const unnamed = { date: "2026-12-01", options: [{ ...inPerson, waitlistAlternative: undefined }, lounge] };
    const draft = attendanceSettingsDraft(response([unnamed, named]), "Europe/Amsterdam");
    const saved = attendanceConfiguration(draft).days;
    expect(saved[0].attendanceOptions[0]).not.toHaveProperty("waitlistAlternative");
    expect(saved[1].attendanceOptions[0]).toMatchObject({ waitlistAlternative: "lounge" });

    const chosen = attendanceConfiguration(
      updateAttendanceDefinition(draft, draft.definitions[0].id, { waitlistAlternative: "lounge" }),
    ).days;
    expect(chosen.map((day) => day.attendanceOptions[0].waitlistAlternative)).toEqual(["lounge", "lounge"]);
  });

  it("drops the alternative when a venue option becomes remote", () => {
    const draft = attendanceSettingsDraft(response([{ date: "2026-12-01", options: [inPerson, lounge] }]), "UTC");
    const remote = updateAttendanceDefinition(draft, draft.definitions[0].id, { accessMode: "remote" });
    expect(remote.definitions[0].option.waitlistAlternative).toBeUndefined();
    const [day] = attendanceConfiguration(remote).days;
    expect(day.attendanceOptions[0]).not.toHaveProperty("waitlistAlternative");
    expect(eventDayInputSchema.safeParse(day).success).toBe(true);
  });

  it("follows a renamed key and clears a removed alternative", () => {
    const draft = attendanceSettingsDraft(
      response([{ date: "2026-12-01", options: [inPerson, lounge] }]),
      "Europe/Amsterdam",
    );
    const [person, lounged] = draft.definitions;
    const renamed = updateAttendanceDefinition(draft, lounged.id, { value: "partner_lounge" });
    expect(renamed.definitions[0].option.waitlistAlternative).toBe("partner_lounge");
    expect(attendanceConfiguration(renamed).days[0].attendanceOptions[0]).toMatchObject({
      waitlistAlternative: "partner_lounge",
    });
    const removed = removeAttendanceDefinition(renamed, lounged.id);
    expect(attendanceConfiguration(removed).days[0].attendanceOptions[0]).not.toHaveProperty("waitlistAlternative");
    expect(removed.definitions).toHaveLength(1);
    expect(removed.definitions[0].id).toBe(person.id);
    expect(removed.definitions[0].option.waitlistAlternative).toBeUndefined();
  });
});
