import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LiveProgramOverlay } from "../../assets/ts/live-session/LiveProgramOverlay";
import { LIVE_PROGRAM_PROTOCOL, liveProgramMessageSchema } from "../../assets/shared/schemas/live-room-program";
import { fakeLiveSockets, liveSnapshot, LIVE_OCCURRENCE } from "./helpers/live-room-socket";
import { liveProgramOverlayExpiresAt, liveProgramPointerPurgeAt } from "../../assets/shared/live-room-program-policy";
let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
});
describe("continuous physical-room source", () => {
  it("keeps one room connection and the last picture until the newly selected session answers", async () => {
    const live = fakeLiveSockets(),
      roomId = "20000000-0000-4000-8000-000000000090",
      next = "20000000-0000-4000-8000-000000000091";
    host = document.createElement("div");
    document.body.append(host);
    await act(() => {
      render(
        <LiveProgramOverlay
          view="program"
          layout="talk"
          slug="synthetic"
          roomId={roomId}
          token="signed-synthetic"
          createSocket={live.factory}
        />,
        host,
      );
    });
    const coordinator = live.latest();
    expect(coordinator.protocols[0]).toBe(LIVE_PROGRAM_PROTOCOL);
    expect(coordinator.url).toContain(`/rooms/${roomId}/live/program`);
    const choose = async (occurrenceId: string | null, revision: number) =>
      act(() => {
        coordinator.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify(
              liveProgramMessageSchema.parse({
                type: "program.changed",
                selection: { roomId, occurrenceId, revision },
              }),
            ),
          }),
        );
      });
    await choose(LIVE_OCCURRENCE, 1);
    const old = live.latest();
    await act(() => {
      old.open();
      old.deliver(
        liveSnapshot({
          viewer: { role: "overlay", name: null },
          stage: {
            question: null,
            ticker: null,
            panelists: null,
            schedule: null,
            checkIn: null,
            questionChange: null,
            lowerThird: {
              key: "first",
              moderator: false,
              roleLabel: null,
              titleLine: null,
              name: "First presenter",
              photoUrl: null,
              identity: null,
              additionalIdentities: [],
            },
            lowerThirdChange: null,
            lowerThirdMotion: "animated" as const,
            poll: null,
            pollChange: null,
            timerGraphics: [],
            topQuestions: null,
            chatFeed: null,
            reactions: false,
            reactionsGraphic: { showCount: false },
            speakerWelcome: false,
            scene: null,
          },
        }),
      );
    });
    expect(host.textContent).toContain("First presenter");
    await choose(next, 2);
    expect(old.readyState).toBe(3);
    // The source keeps the last picture until the new session answers, so it never blanks on air.
    expect(host.textContent).toContain("First presenter");
    const selected = live.latest();
    expect(selected.url).toContain(`/occurrences/${next}/live`);
    expect(live.sockets.filter((socket) => socket.protocols[0] === LIVE_PROGRAM_PROTOCOL)).toHaveLength(1);
    await act(() => {
      selected.open();
      selected.deliver(liveSnapshot({ viewer: { role: "overlay", name: null } }));
    });
    // The new session has no lower third, so the previous one leaves the way it always does.
    expect(host.querySelector(".pk-live-overlay__lower-third-graphic")?.getAttribute("data-phase")).toBe("exiting");
    await choose(null, 3);
    expect(selected.readyState).toBe(3);
    expect(host.textContent).toBe("");
  });
  it("uses the existing seven-day lifecycle retention for physical-room pointers", () => {
    expect(liveProgramPointerPurgeAt("2030-12-03T17:00:00.000Z", "2030-12-01T09:00:00.000Z")).toBe(
      Date.parse("2030-12-10T17:00:00.000Z"),
    );
    expect(liveProgramPointerPurgeAt(null, "2030-12-01T09:00:00.000Z")).toBe(Date.parse("2030-12-08T09:00:00.000Z"));
  });
  it("keeps a room's output links until a day after its program ends, the same whenever they are asked for", () => {
    const now = Date.parse("2030-10-01T09:00:00.000Z");
    expect(liveProgramOverlayExpiresAt("2030-12-03T17:00:00.000Z", now)).toBe("2030-12-04T17:00:00.000Z");
    expect(liveProgramOverlayExpiresAt("2030-12-03T17:00:00.000Z", now + 86_400_000)).toBe("2030-12-04T17:00:00.000Z");
    expect(liveProgramOverlayExpiresAt(null, now)).toBe("2030-10-02T09:00:00.000Z");
    expect(liveProgramOverlayExpiresAt("invalid", now)).toBe("2030-10-02T09:00:00.000Z");
  });
});
