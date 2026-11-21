import { describe, expect, it } from "vitest";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { eventPhase } from "../../assets/ts/member-flows/portal/sections/events/app/event-timing";
import { pickEventNow } from "../../assets/ts/member-flows/portal/sections/events/app/useEventNow";
import { participantAgendaSession } from "../helpers/participant-event";

const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const sessionIds = ["a0000000-0000-4000-8000-000000000011", "a0000000-0000-4000-8000-000000000012"];

describe("event timing", () => {
  it("names the event's phase relative to now", () => {
    expect(eventPhase(null, null).kind).toBe("unscheduled");
    expect(eventPhase("2026-12-01T08:00:00.000Z", "2026-12-03T17:00:00.000Z", NOW).label).toBe("Live now");
    expect(eventPhase("2026-11-01T08:00:00.000Z", "2026-11-02T17:00:00.000Z", NOW).label).toBe("Ended");
    expect(eventPhase(new Date(Date.now() + 3 * 86_400_000).toISOString(), null).label).toBe("Starts in 3 days");
  });

  it("picks the reader's next unfinished session, not one that has ended", () => {
    const sessions = personalAgendaResponseSchema.parse({
      sessions: [
        participantAgendaSession(
          sessionIds[0]!,
          "Done",
          "2026-12-01T08:00:00.000Z",
          "2026-12-01T09:00:00.000Z",
          "reserved",
        ),
        participantAgendaSession(
          sessionIds[1]!,
          "Next",
          "2026-12-01T11:00:00.000Z",
          "2026-12-01T12:00:00.000Z",
          "saved",
        ),
      ],
      page: { limit: 100, offset: 0, total: 2, hasMore: false },
    }).sessions;
    expect(pickEventNow(sessions, NOW).next?.title).toBe("Next");
    expect(pickEventNow(sessions, NOW).live).toEqual([]);
  });
});
