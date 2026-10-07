import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => ({ getJson: mocks.get }));
import { RoomRecommendations } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/RoomRecommendations";
import { evaluateRoomFits } from "../../assets/shared/event-agenda-room-fit";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
const host = document.createElement("div");
afterEach(() => {
  render(null, host);
  vi.clearAllMocks();
});
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "UTC",
  revision: 1,
  publishedRevision: 0,
  travelMinutes: 0,
  rooms: [
    { id: "small", name: "Small", capacity: 1, equipment: ["projector"] },
    { id: "large", name: "Large", capacity: 3, equipment: ["projector"] },
    { id: "busy", name: "Busy", capacity: 10, equipment: ["projector"] },
  ],
  occurrences: [
    {
      id: "session",
      title: "Workshop",
      startAt: "2027-01-20T09:00:00.000Z",
      endAt: "2027-01-20T10:00:00.000Z",
      roomId: "small",
      capacity: 1,
      requiredEquipment: ["projector"],
      speakers: [],
    },
    {
      id: "other",
      title: "Other",
      startAt: "2027-01-20T09:00:00.000Z",
      endAt: "2027-01-20T10:00:00.000Z",
      roomId: "busy",
      speakers: [],
    },
  ],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
describe("Organizer room fit and explicit review", () => {
  it("preserves protected locations and rejects schedule conflicts without adding capacities", () => {
    const fits = evaluateRoomFits(snapshot, "session", ["small"], 2, 1, { small: 1 }, []);
    expect(fits.find((room) => room.roomId === "large")).toMatchObject({
      fit: "review",
      proposedAdditionalRoomIds: ["small"],
      proposedCapacity: 2,
      newRoomDemand: 1,
    });
    expect(fits.find((room) => room.roomId === "small")?.fit).toBe("unavailable");
    expect(fits.find((room) => room.roomId === "busy")?.fit).toBe("unavailable");
    expect(snapshot.occurrences[0]!.roomId).toBe("small");
  });
  it("requires equipment, room opening intervals and cross-event availability", () => {
    const altered = {
      ...snapshot,
      rooms: [
        {
          ...snapshot.rooms[1]!,
          equipment: [],
          availablePeriods: [{ startAt: "2027-01-20T12:00:00.000Z", endAt: "2027-01-20T13:00:00.000Z" }],
        },
      ],
    };
    const fit = evaluateRoomFits(altered, "session", [], 1, 0, {}, ["large"])[0]!;
    expect(fit.fit).toBe("unavailable");
    expect(fit.reasons.join(" ")).toContain("required equipment");
    expect(fit.reasons.join(" ")).toContain("unavailable");
    expect(fit.reasons.join(" ")).toContain("cross-event");
  });
  it("shows physical and remote demand separately and only opens a proposal on explicit review", async () => {
    const proposal = evaluateRoomFits(snapshot, "session", ["small"], 2, 1, { small: 1 }, []).find(
      (room) => room.roomId === "large",
    )!;
    mocks.get.mockResolvedValue({
      occurrenceId: "session",
      revision: 1,
      demand: {
        physical: { confirmed: 1, pending: 0, waitlisted: 1, preferences: 20000, occupied: 1 },
        remote: { confirmed: 7, pending: 0, waitlisted: 0, preferences: 2, occupied: 7 },
      },
      recommendations: [proposal],
    });
    const review = vi.fn();
    await act(async () => render(<RoomRecommendations slug="event" occurrenceId="session" onReview={review} />, host));
    await act(async () => {});
    expect(host.textContent).toContain("20,000 saved preferences");
    expect(host.textContent).toContain("Remote:");
    expect(host.textContent).toContain("7 confirmed");
    expect(host.textContent).toContain("active booking holds");
    expect(host.textContent).toContain("Badge scans are reported separately");
    expect(host.textContent).not.toContain("offline rights");
    expect(review).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Review Large",
    )!;
    await act(async () => button.click());
    expect(review).toHaveBeenCalledWith(proposal);
  });
});
