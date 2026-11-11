// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screenReadResponseSchema, type ScreenOwnView } from "../../assets/shared/schemas/event-screens";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { parseScreenPageAddress } from "../../assets/ts/event-screens/screen-address";
import type { ScreenApi } from "../../assets/ts/event-screens/screen-api";
import { ScreenApp } from "../../assets/ts/event-screens/ScreenApp";
import { createScreenClock } from "../../assets/ts/event-screens/screen-clock";
import { SCREEN_HANDOFF } from "../../assets/ts/event-screens/screen-handoff";
import { ScreenPairing } from "../../assets/ts/event-screens/ScreenStatus";

let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
});

it("reads the screen ID from the fragment only, as the screen prints it", () => {
  expect(parseScreenPageAddress({ hash: "#id=K7M2QA" })).toEqual({ screenId: "K7M2QA" });
  expect(parseScreenPageAddress({ hash: "#id=k7m2qa" })).toEqual({ screenId: "K7M2QA" });
  expect(parseScreenPageAddress({ hash: "#id=K7M2Q1" })).toBeNull();
  expect(parseScreenPageAddress({ hash: "" })).toBeNull();
});

it("shows the pairing code and the screen ID staff enter together", async () => {
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<ScreenPairing screenId="K7M2QA" pairing={{ code: "HJKP4QRT", expiresIn: "9:41" }} />, host!));
  const values = [...host.querySelectorAll("dd")].map((value) => value.textContent);
  expect(values).toEqual(["HJKP4QRT", "K7M2QA"]);
});

describe("the screen runtime", () => {
  const SCREEN = "K7M2QA";
  const mustPair = (code = "SCREEN_SESSION_MISSING") => new ApiClientError({ error: { code, message: "Pair" } }, 401);
  const unreachable = () => new ApiClientError({ error: { code: "NETWORK_UNAVAILABLE", message: "Down" } }, 0);
  const ownView = (assignment: ScreenOwnView["screen"]["assignment"] = null) =>
    screenReadResponseSchema.parse({
      viewer: "screen",
      screen: { id: SCREEN, name: "Foyer, by registration", assignment },
      serverNow: new Date().toISOString(),
      agenda: null,
      livestream: null,
      overlay: null,
    });
  function fakeApi() {
    return {
      read: vi.fn<ScreenApi["read"]>(),
      startPairing: vi.fn<ScreenApi["startPairing"]>(),
      pollSession: vi.fn<ScreenApi["pollSession"]>(),
    };
  }
  const timed = (response: ReturnType<typeof ownView>) => ({ response, sentAt: Date.now(), receivedAt: Date.now() });
  async function mountApp(api: ReturnType<typeof fakeApi>, onHandoff = vi.fn()) {
    host = document.body.appendChild(document.createElement("div"));
    await act(() =>
      render(
        <ScreenApp
          screenId={SCREEN}
          storage={localStorage}
          clock={createScreenClock()}
          api={api}
          onHandoff={onHandoff}
        />,
        host!,
      ),
    );
    return onHandoff;
  }
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pairs, waits for an assignment, and pairs again when its sign-in is revoked", async () => {
    const api = fakeApi();
    api.read.mockRejectedValueOnce(mustPair());
    api.startPairing.mockResolvedValue({ code: "HJKP4QRT", expiresAt: new Date(Date.now() + 600_000).toISOString() });
    api.pollSession
      .mockResolvedValueOnce({ status: "pending", expiresAt: new Date(Date.now() + 600_000).toISOString() })
      .mockResolvedValueOnce({ status: "active", expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await mountApp(api);
    // Effects run after the next frame.
    await advance(100);
    expect(host!.querySelector("dd")?.textContent).toBe("HJKP4QRT");

    api.read.mockResolvedValue(timed(ownView()));
    await advance(3_000);
    expect(host!.textContent).toContain("HJKP4QRT");
    await advance(3_000);
    expect(host!.textContent).toContain("Foyer, by registration");
    expect(host!.textContent).toContain("Not assigned yet");
    expect(localStorage.getItem(`pkic.screen.${SCREEN}`)).not.toBeNull();

    api.read.mockRejectedValue(mustPair("SCREEN_SESSION_REVOKED"));
    await advance(60_000);
    // The new code arrives after the pairing page's next frame.
    await advance(100);
    expect(host!.querySelector("dd")?.textContent).toBe("HJKP4QRT");
    expect(localStorage.getItem(`pkic.screen.${SCREEN}`)).toBeNull();
  });

  it("asks for a new code before the shown one expires", async () => {
    const api = fakeApi();
    api.read.mockRejectedValue(mustPair());
    api.startPairing
      .mockResolvedValueOnce({ code: "HJKP4QRT", expiresAt: new Date(Date.now() + 20_000).toISOString() })
      .mockResolvedValue({ code: "MNPQ2345", expiresAt: new Date(Date.now() + 600_000).toISOString() });
    api.pollSession.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await mountApp(api);
    await advance(3_100);
    expect(host!.querySelector("dd")?.textContent).toBe("MNPQ2345");
  });

  it("shows its last good state at once and hands off only when it has none", async () => {
    const api = fakeApi();
    api.read.mockRejectedValue(unreachable());
    const onHandoff = await mountApp(api);
    await advance(SCREEN_HANDOFF.unreachableMs + 2_000);
    expect(onHandoff).toHaveBeenCalled();
    await act(() => render(null, host!));

    localStorage.setItem(
      `pkic.screen.${SCREEN}`,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        view: { ...ownView(), overlay: null, agenda: null },
        agenda: null,
        live: null,
      }),
    );
    const kept = await mountApp(api);
    expect(host!.textContent).toContain("Foyer, by registration");
    await advance(SCREEN_HANDOFF.unreachableMs + 2_000);
    expect(kept).not.toHaveBeenCalled();
    // Long silent, the waiting page says how long.
    expect(host!.textContent).toMatch(/Offline · \d+ min/);
  });
});
