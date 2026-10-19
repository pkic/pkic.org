/**
 * The viewer's standing at an event: expected states as plain words, and a
 * tone only for a state that changes what the viewer does next — never green.
 */
import { describe, expect, it } from "vitest";
import { eventViewerStatus } from "../../assets/ts/member-flows/portal/sections/events/event-viewer-status";
import type { EventParticipation } from "../../assets/shared/schemas/event-participation";

function participation(overrides: Partial<EventParticipation> = {}): EventParticipation {
  return {
    registrationId: null,
    registrationStatus: null,
    proposals: 0,
    speakerProposals: 0,
    proposalStates: [],
    speakerStates: [],
    ...overrides,
  };
}

describe("event viewer status", () => {
  it("writes expected states as plain text", () => {
    expect(
      eventViewerStatus({
        participation: participation({
          registrationStatus: "registered",
          proposals: 2,
          proposalStates: ["accepted"],
          speakerProposals: 2,
          speakerStates: ["confirmed"],
        }),
      }),
    ).toEqual([
      { label: "You're registered" },
      { label: "2 proposals (accepted)" },
      { label: "Speaker on 2 proposals" },
    ]);
  });

  it("flags only what needs the viewer, in a warning or danger tone", () => {
    const status = eventViewerStatus({
      participation: participation({
        registrationStatus: "pending_email_confirmation",
        proposals: 2,
        proposalStates: ["needs-work", "rejected"],
        speakerProposals: 1,
        speakerStates: ["invited"],
      }),
    });
    expect(status).toEqual([
      { label: "Confirm your registration", tone: "warn" },
      { label: "2 proposals" },
      { label: "Proposal needs work", tone: "warn" },
      { label: "Proposal rejected", tone: "danger" },
      { label: "Answer speaker invitation", tone: "warn" },
    ]);
    expect(status.some((item) => (item.tone as string | undefined) === "ok")).toBe(false);
  });

  it("says nothing for a viewer with no standing", () => {
    expect(eventViewerStatus({ participation: participation(), viewer: null })).toEqual([]);
  });
});
