// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LIVE_OVERLAY_PROTOCOL_PREFIX, liveRoomRefusalCloseCode } from "../../assets/shared/schemas/live-session-room";
import { useLiveRoom } from "../../assets/ts/live-session/useLiveRoom";
import { useLiveRoomProgram } from "../../assets/ts/live-session/useLiveRoomProgram";
import { fakeLiveSockets, LIVE_OCCURRENCE, liveSnapshot } from "./helpers/live-room-socket";

let host: HTMLElement | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  vi.restoreAllMocks();
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
  vi.useRealTimers();
});

it("keeps a screen's room state through refusals and retries forever with the newest access", async () => {
  const sockets = fakeLiveSockets();
  const onRefusal = vi.fn();
  const onActivity = vi.fn();
  let seen: ReturnType<typeof useLiveRoom> | undefined;
  function Probe({ token }: { token: string }) {
    seen = useLiveRoom({
      slug: "pqc-2026",
      occurrenceId: LIVE_OCCURRENCE,
      overlayToken: token,
      output: "stage-display",
      createSocket: sockets.factory,
      persistent: { onRefusal, onActivity },
    });
    return null;
  }
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<Probe token="first" />, host!));
  sockets.latest().open();
  await act(() => sockets.latest().deliver(liveSnapshot()));
  expect(seen?.status).toBe("live");
  expect(onActivity).toHaveBeenCalled();

  // Renewed access does not reconnect; the next attempt offers it.
  await act(() => render(<Probe token="second" />, host!));
  expect(sockets.sockets).toHaveLength(1);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await act(() => sockets.latest().refuse(liveRoomRefusalCloseCode(401), "LIVE_OVERLAY_ACCESS_INVALID"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
  }
  expect(onRefusal).toHaveBeenCalledWith("LIVE_OVERLAY_ACCESS_INVALID");
  expect(sockets.sockets).toHaveLength(9);
  expect(sockets.latest().protocols).toContain(`${LIVE_OVERLAY_PROTOCOL_PREFIX}second`);
  expect(seen?.state?.session.title).toBe(liveSnapshot().session.title);
});

it("keeps a screen's program selection when the program refuses it", async () => {
  const sockets = fakeLiveSockets();
  let seen: ReturnType<typeof useLiveRoomProgram> | undefined;
  function Probe() {
    seen = useLiveRoomProgram({
      slug: "pqc-2026",
      roomId: "30000000-0000-4000-8000-000000000001",
      overlayToken: "access",
      createSocket: sockets.factory,
      persistent: {},
    });
    return null;
  }
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<Probe />, host!));
  sockets.latest().open();
  await act(() => {
    sockets.latest().dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "program.snapshot",
          selection: { roomId: "30000000-0000-4000-8000-000000000001", occurrenceId: LIVE_OCCURRENCE, revision: 2 },
        }),
      }),
    );
  });
  expect(seen?.selection?.occurrenceId).toBe(LIVE_OCCURRENCE);
  await act(() => sockets.latest().refuse(liveRoomRefusalCloseCode(401), "LIVE_OVERLAY_ACCESS_INVALID"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(seen?.selection?.occurrenceId).toBe(LIVE_OCCURRENCE);
  expect(sockets.sockets).toHaveLength(2);
});

it("backs off a screen's room retries while each attempt opens and is then refused", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const sockets = fakeLiveSockets();
  function Probe() {
    useLiveRoom({
      slug: "pqc-2026",
      occurrenceId: LIVE_OCCURRENCE,
      overlayToken: "access",
      output: "stage-display",
      createSocket: sockets.factory,
      persistent: {},
    });
    return null;
  }
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<Probe />, host!));
  // Delays 0.5 s, 1 s, 2 s: a refusal that first opens must not start the count over.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sockets.latest().open();
    await act(() => sockets.latest().refuse(liveRoomRefusalCloseCode(401), "LIVE_OVERLAY_ACCESS_INVALID"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
  }
  expect(sockets.sockets).toHaveLength(3);
});

it("backs off a screen's program retries while each attempt opens and is then refused", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const sockets = fakeLiveSockets();
  function Probe() {
    useLiveRoomProgram({
      slug: "pqc-2026",
      roomId: "30000000-0000-4000-8000-000000000001",
      overlayToken: "access",
      createSocket: sockets.factory,
      persistent: {},
    });
    return null;
  }
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<Probe />, host!));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sockets.latest().open();
    await act(() => sockets.latest().refuse(liveRoomRefusalCloseCode(401), "LIVE_OVERLAY_ACCESS_INVALID"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
  }
  expect(sockets.sockets).toHaveLength(3);
});

it("tells a screen when the room sends what its page cannot read, as after a deploy", async () => {
  const sockets = fakeLiveSockets();
  const onUnreadable = vi.fn();
  let seen: ReturnType<typeof useLiveRoom> | undefined;
  function Probe() {
    seen = useLiveRoom({
      slug: "pqc-2026",
      occurrenceId: LIVE_OCCURRENCE,
      overlayToken: "access",
      output: "stage-display",
      createSocket: sockets.factory,
      persistent: { onUnreadable },
    });
    return null;
  }
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<Probe />, host!));
  sockets.latest().open();
  await act(() => sockets.latest().deliver(liveSnapshot()));
  expect(seen?.status).toBe("live");
  // A newer release's frame carries a field this page's contract does not know; the socket stays open.
  const data = JSON.stringify({ ...liveSnapshot(), fromANewerRelease: true });
  await act(() => {
    sockets.latest().dispatchEvent(new MessageEvent("message", { data }));
  });
  expect(onUnreadable).toHaveBeenCalledOnce();
  expect(seen?.status).toBe("offline");
  // The next snapshot it can read brings it back.
  await act(() => sockets.latest().deliver(liveSnapshot()));
  expect(seen?.status).toBe("live");
});
