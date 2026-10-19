import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LiveProgramOverlay } from "../../assets/ts/live-session/LiveProgramOverlay";
import { LIVE_PROGRAM_PROTOCOL, liveProgramMessageSchema } from "../../assets/shared/schemas/live-room-program";
import { fakeLiveSockets, liveSnapshot, LIVE_OCCURRENCE } from "./helpers/live-room-socket";
import { liveProgramOverlayAccessHours, liveProgramPointerPurgeAt } from "../../assets/shared/live-room-program-policy";
let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
});
describe("continuous physical-room source", () => {
  it("keeps one room connection, clears old content on selection and closes the replaced session source", async () => {
    const live = fakeLiveSockets(),
      roomId = "20000000-0000-4000-8000-000000000090",
      next = "20000000-0000-4000-8000-000000000091";
    host = document.createElement("div");
    document.body.append(host);
    await act(() => {
      render(
        <LiveProgramOverlay
          view="program"
          layout="lower-third"
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
              name: "First presenter",
              photoUrl: null,
              identity: null,
            },
            lowerThirdChange: null,
            lowerThirdMotion: "animated" as const,
            poll: null,
            pollChange: null,
            timerGraphics: [],
          },
        }),
      );
    });
    expect(host.textContent).toContain("First presenter");
    await choose(next, 2);
    expect(old.readyState).toBe(3);
    expect(host.textContent).not.toContain("First presenter");
    const selected = live.latest();
    expect(selected.url).toContain(`/occurrences/${next}/live`);
    expect(live.sockets.filter((socket) => socket.protocols[0] === LIVE_PROGRAM_PROTOCOL)).toHaveLength(1);
    await act(() => {
      old.deliver(liveSnapshot({ viewer: { role: "overlay", name: null } }));
    });
    expect(host.textContent).not.toContain("First presenter");
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
  it("extends a source by program duration rather than waiting months until a future event", () => {
    expect(liveProgramOverlayAccessHours("2030-12-01T09:00:00.000Z", "2030-12-03T17:00:00.000Z")).toBe(80);
    expect(liveProgramOverlayAccessHours(null, null)).toBe(24);
    expect(liveProgramOverlayAccessHours("invalid", "2030-12-03T17:00:00.000Z")).toBe(24);
    expect(liveProgramOverlayAccessHours("2030-12-03T17:00:00.000Z", "2030-12-01T09:00:00.000Z")).toBe(24);
  });
});
