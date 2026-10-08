import { describe, expect, it } from "vitest";
import {
  participationAvailability,
  type AvailabilityEvidence,
} from "../../assets/shared/event-participation-availability";
import { eventParticipationLink } from "../../assets/shared/event-participation-link";
const now = "2026-10-04T10:00:00.000Z";
const base: AvailabilityEvidence = {
  attendanceMode: "physical",
  roomId: "room",
  policy: "reservation",
  invitationRequired: false,
  invited: false,
  registered: true,
  registrationMode: "in_person",
  opensAt: null,
  closesAt: null,
  sessionCapacity: 10,
  sessionOccupied: 2,
  roomCapacity: 5,
  roomOccupied: 2,
  allocationCompatible: true,
};
describe("participant availability projection", () => {
  it("keeps preference, approval and confirmed reservation promises distinct", () => {
    expect(participationAvailability({ ...base, policy: "preference" }, now)).toMatchObject({
      bookingAction: null,
      canSave: true,
    });
    expect(participationAvailability({ ...base, policy: "approval" }, now)).toMatchObject({ bookingAction: "request" });
    expect(participationAvailability(base, now).message).toContain("only after the server accepts");
  });
  it("uses both selected room and aggregate capacity while allowing waiting-list interest", () => {
    const full = participationAvailability({ ...base, roomOccupied: 5 }, now);
    expect(full).toMatchObject({ state: "full", bookingAction: "reserve", canSave: true });
    expect(full.message).toContain("waiting list");
    expect(participationAvailability({ ...base, sessionOccupied: 10 }, now).state).toBe("full");
    expect(participationAvailability({ ...base, roomCapacity: 0 }, now)).toMatchObject({
      state: "closed",
      bookingAction: null,
    });
  });
  it("resolves invitations, event registration, selected mode and approved placement before booking", () => {
    expect(participationAvailability({ ...base, invitationRequired: true }, now).state).toBe("invitation_required");
    expect(participationAvailability({ ...base, registered: false }, now).state).toBe("registration_required");
    expect(participationAvailability({ ...base, attendanceMode: "remote" }, now).state).toBe("wrong_mode");
    expect(participationAvailability({ ...base, allocationCompatible: false }, now).state).toBe("allocation_conflict");
    expect(
      participationAvailability(
        { ...base, attendanceMode: "remote", roomId: null, registrationMode: "virtual", roomCapacity: null },
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
    expect(link.label).toBe("Invitation required");
    expect(link.message).toContain("Sign in");
    expect(eventParticipationLink("event", "id", "preference")).toMatchObject({
      label: "Save preference",
      preference: true,
    });
    expect(eventParticipationLink("event", "id", "reservation").preference).toBe(false);
    expect(link.preference).toBe(false);
  });
});
