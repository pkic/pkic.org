import { describe, expect, it } from "vitest";
import { eventPlaceSummary } from "../../assets/shared/event-place";
import {
  eventVenueLines,
  type ParticipantEventDetail,
} from "../../assets/ts/member-flows/portal/sections/events/app/event-app-model";
import { participantEventFixture } from "../helpers/participant-event";
describe("event venue display", () => {
  it("names the venue and city once and keeps the full address for the venue details", () => {
    const managed = {
      ...participantEventFixture(),
      venue: "Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands",
      city: "Amsterdam",
      country: "NL",
    } as ParticipantEventDetail;
    expect(eventPlaceSummary(managed)).toBe("Meervaart · Amsterdam");
    expect(eventVenueLines(managed)).toEqual(["Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands"]);
    expect(eventVenueLines({ ...managed, city: "Amstelveen" })).toEqual([
      "Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands",
      "Amstelveen, Netherlands",
    ]);
    expect(eventPlaceSummary({ ...participantEventFixture(), city: "Amsterdam" })).toBe("Amsterdam");
  });
});
