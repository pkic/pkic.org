// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { personalAgendaSessionSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { WatchLiveCard } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/WatchLiveCard";

const HALL = "a0000000-0000-4000-8000-000000000001";
const KEYNOTE = "b0000000-0000-4000-8000-000000000001";
const WORKSHOP = "b0000000-0000-4000-8000-000000000003";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("watch live entry", () => {
  const live = (liveStreamRoomId: string | null, id: string, title: string) =>
    personalAgendaSessionSchema.parse({
      id,
      publishedRevision: 4,
      title,
      liveStreamRoomId,
      rooms: [{ id: HALL, name: "Main hall" }],
      timeZone: "UTC",
      startAt: "2027-01-20T09:00:00.000Z",
      endAt: "2027-01-20T10:00:00.000Z",
      admissionPolicy: "preference",
      status: null,
      attendanceMode: null,
    });

  it("sends a virtual attendee into the streaming location's room for the running session", async () => {
    const sessions = [live(null, WORKSHOP, "Unstreamed lab"), live(HALL, KEYNOTE, "Opening keynote")];
    await act(async () => {
      render(<WatchLiveCard slug="summit" live={sessions} />, host);
    });
    expect(host.querySelector("h3")?.textContent).toBe("Opening keynote");
    const watch = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Watch live");
    expect(watch?.getAttribute("href")).toBe(`#/events/summit/virtual?room=${HALL}&session=${KEYNOTE}`);
  });

  it("is absent while nothing running is streamed", async () => {
    await act(async () => {
      render(<WatchLiveCard slug="summit" live={[live(null, WORKSHOP, "Unstreamed lab")]} />, host);
    });
    expect(host.textContent).toBe("");
  });
});
