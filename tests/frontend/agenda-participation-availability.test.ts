import { describe, expect, it } from "vitest";
import {
  participationAvailability,
  sessionAttendanceModeForDay,
  type AvailabilityEvidence,
} from "../../assets/shared/event-participation-availability";
import { eventParticipationLink } from "../../assets/shared/event-participation-link";
const now = "2026-10-04T10:00:00.000Z";
const base: AvailabilityEvidence = {
  attendanceMode: "physical",
  policy: "reservation",
  invitationRequired: false,
  invited: false,
  registered: true,
  registrationMode: "in_person",
  opensAt: null,
  closesAt: null,
  sessionCapacity: 10,
  sessionOccupied: 2,
  poolCapacity: 5,
  poolOccupied: 2,
  allocationCompatible: true,
};
describe("participant availability projection", () => {
  it("keeps preference, approval and confirmed reservation promises distinct", () => {
    expect(participationAvailability({ ...base, policy: "preference" }, now)).toMatchObject({ bookingAction: null });
    expect(participationAvailability({ ...base, policy: "approval" }, now)).toMatchObject({ bookingAction: "request" });
    expect(participationAvailability(base, now).message).toContain("only after the server accepts");
  });
  it("uses both the combined room pool and the session limit while allowing waiting-list interest", () => {
    const full = participationAvailability({ ...base, poolOccupied: 5 }, now);
    expect(full).toMatchObject({ state: "full", bookingAction: "reserve" });
    expect(full.message).toContain("waiting list");
    expect(participationAvailability({ ...base, sessionOccupied: 10 }, now).state).toBe("full");
    expect(participationAvailability({ ...base, poolCapacity: 0 }, now)).toMatchObject({
      state: "closed",
      bookingAction: null,
    });
  });
  it("resolves invitations, event registration, the day's attendance mode and approved placement before booking", () => {
    expect(participationAvailability({ ...base, invitationRequired: true }, now).state).toBe("invitation_required");
    expect(participationAvailability({ ...base, registered: false }, now).state).toBe("registration_required");
    expect(participationAvailability({ ...base, attendanceMode: "remote" }, now).state).toBe("wrong_mode");
    expect(participationAvailability({ ...base, attendanceMode: null, registrationMode: "on_demand" }, now).state).toBe(
      "wrong_mode",
    );
    expect(participationAvailability({ ...base, allocationCompatible: false }, now).state).toBe("allocation_conflict");
    expect(
      participationAvailability(
        { ...base, attendanceMode: "remote", registrationMode: "virtual", poolCapacity: null },
        now,
      ).state,
    ).toBe("available");
  });
  it("closes precisely at the booking deadline", () => {
    expect(participationAvailability({ ...base, opensAt: "2026-10-04T10:00:01.000Z" }, now).state).toBe("not_open");
    expect(participationAvailability({ ...base, opensAt: now }, now).state).toBe("available");
    expect(participationAvailability({ ...base, closesAt: now }, now).state).toBe("closed");
  });
  it("builds static sign-in links without pretending to know current capacity", () => {
    const link = eventParticipationLink("event name", "session/id", "reservation", "invitation");
    expect(link.url).toBe("/portal/#/events/event%20name/agenda?session=session%2Fid");
    expect(link.label).toBe("By invitation only");
    expect(link.message).toContain("Sign in");
    expect(eventParticipationLink("event", "id", "preference")).toMatchObject({
      label: "Save favorite",
      preference: true,
    });
    expect(eventParticipationLink("event", "id", "reservation").preference).toBe(false);
    expect(link.preference).toBe(false);
    for (const policy of ["preference", "optional_reservation", "reservation", "approval"] as const) {
      const candidate = eventParticipationLink("event", "id", policy, "invitation");
      expect(candidate.favorite.label).toBe("Save favorite");
      expect(candidate.favorite.message).toContain("does not register");
      expect(candidate.label).toBe("By invitation only");
      expect(candidate.policyLabel).toBe("By invitation only");
    }
    expect(eventParticipationLink("event", "id", "optional_reservation")).toMatchObject({
      policyLabel: "Reserve to guarantee a seat · remaining seats first come, first served",
      label: "Reserve a seat",
      preference: false,
    });
    expect(eventParticipationLink("event", "id", "reservation")).toMatchObject({
      policyLabel: "Registration required · registered attendees only",
      label: "Reserve a seat",
    });
    expect(eventParticipationLink("event", "id", "approval")).toMatchObject({
      policyLabel: "Admission by approval",
      label: "Request a seat",
    });
    expect(eventParticipationLink("event", "id", "preference").policyLabel).toBe(
      "Open session · first come, first served",
    );
  });
  it("attends a session the way the person attends its day", () => {
    expect(sessionAttendanceModeForDay("in_person")).toBe("physical");
    expect(sessionAttendanceModeForDay("virtual")).toBe("remote");
    expect(sessionAttendanceModeForDay("on_demand")).toBeNull();
    expect(sessionAttendanceModeForDay(null)).toBeNull();
  });
});
