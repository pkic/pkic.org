import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  scannerSuggestionsResponseSchema,
  type ScannerSuggestion,
} from "../../assets/shared/schemas/event-scanner-suggestions";
import { ScannerSetup } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerSetup";
import { scannerTargetsResponseSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { useScannerLocation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerLocation";
import { useScannerSuggestions } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerSuggestions";
const session = "11111111-1111-4111-8111-111111111111";
const room = "22222222-2222-4222-8222-222222222222";
const block = "33333333-3333-4333-8333-333333333333";
const operator = "44444444-4444-4444-8444-444444444444";
const candidate: ScannerSuggestion = {
  shiftId: block,
  shiftName: "Morning",
  roles: ["MC"],
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T11:00:00.000Z",
  status: "current",
  occurrence: {
    id: session,
    title: "Quantum readiness",
    startAt: "2026-12-01T10:00:00.000Z",
    endAt: "2026-12-01T10:30:00.000Z",
    rooms: [{ id: room, name: "Main hall" }],
  },
  suggestedRoomId: room,
};
const response = (suggestions = [candidate], truncated = false) =>
  new Response(
    JSON.stringify(
      scannerSuggestionsResponseSchema.parse({
        timeZone: "Europe/Amsterdam",
        serverTime: "2026-12-01T10:05:00.000Z",
        publishedRevision: 4,
        suggestions,
        truncated,
      }),
    ),
    { headers: { "content-type": "application/json" } },
  );
const choose = vi.fn();
type Options = Parameters<typeof useScannerSuggestions>[0];
let host: HTMLDivElement;
let props: Options;
function Harness(options: Options) {
  const state = useScannerSuggestions(options);
  return (
    <>
      <button
        onClick={() => {
          state.manual();
          choose(null);
        }}
      >
        Event admission
      </button>
      <button onClick={state.manual}>Choose room manually</button>
      <button onClick={state.refresh}>Refresh assignments</button>
      {state.suggestions.map((suggestion) => (
        <button onClick={() => state.choose(suggestion)}>
          {suggestion.occurrence.title} {suggestion.roles.join(" / ")}
        </button>
      ))}
      <p>{state.error}</p>
    </>
  );
}
function LocationHarness({ lead }: { lead: boolean }) {
  const location = useScannerLocation("conference", session, !lead, choose);
  return (
    <>
      <ScannerSetup
        {...location}
        timeZone={location.timeZone ?? undefined}
        label={location.targetLabel}
        slug="conference"
        operatorUserId={operator}
        sponsorOnly={lead}
        explicitTarget
        ready
        locked={false}
        targetField={{}}
        roomField={{}}
        onTarget={location.selectTarget}
        onRoom={location.selectRoom}
      />
      <output data-location-state>
        {JSON.stringify({ target: location.targetId, room: location.roomId, rooms: location.rooms })}
      </output>
    </>
  );
}
function targetResponse() {
  return new Response(
    JSON.stringify(
      scannerTargetsResponseSchema.parse({
        timeZone: "Europe/Amsterdam",
        serverNow: "2026-12-01T10:05:00.000Z",
        rooms: candidate.occurrence.rooms,
        roomsTruncated: false,
        sessions: [candidate.occurrence],
        page: { limit: 50, offset: 0, total: 1, hasMore: false },
      }),
    ),
    { headers: { "content-type": "application/json" } },
  );
}
async function showLocation(lead: boolean) {
  if (!host?.isConnected) {
    host = document.createElement("div");
    document.body.append(host);
  }
  await act(() => render(<LocationHarness lead={lead} />, host));
  await settle();
}
function locationState() {
  return JSON.parse(host.querySelector("[data-location-state]")!.textContent!);
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(overrides: Partial<Options> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  props = {
    slug: "conference",
    operatorUserId: operator,
    enabled: true,
    explicitTarget: false,
    ready: true,
    locked: false,
    onChoose: choose,
    ...overrides,
  };
  await act(() => render(<Harness {...props} />, host));
  await settle();
}
async function update(overrides: Partial<Options>) {
  props = { ...props, ...overrides };
  await act(() => render(<Harness {...props} />, host));
  await settle();
}
async function click(label: string) {
  await act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)!.click(),
  );
  await settle();
}
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
  choose.mockReset();
});
describe("assigned scanner setup", () => {
  it("omits all check-in metadata and lookup errors for a sponsor-only lead scanner", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "PERMISSION_REQUIRED",
              message: `Missing required permission agenda:check in ${session}`,
            },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await showLocation(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Session");
    expect(host.textContent).not.toContain("Physical room");
    expect(host.textContent).not.toContain("Missing required permission");
    expect(host.textContent).not.toContain("agenda:check");
    expect(locationState()).toEqual({ target: null, room: null, rooms: [] });
  });

  it("preserves normal check-in choices across lead mode and ignores its aborted metadata response", async () => {
    let resolveMetadata!: (response: Response) => void;
    let metadataSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("occurrenceId=")) {
        metadataSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveMetadata = resolve;
        });
      }
      return path.includes("/suggestions") ? response() : targetResponse();
    });
    vi.stubGlobal("fetch", fetcher);
    await showLocation(false);
    await click("Choose session or room");
    expect(host.querySelector("dialog[open]")?.textContent).toContain("Choose check-in session");
    expect(host.textContent).toContain("Session");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/scans/targets"))).toBe(true);
    await showLocation(true);
    expect(metadataSignal?.aborted).toBe(true);
    const countAtLead = fetcher.mock.calls.length;
    resolveMetadata(targetResponse());
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(countAtLead);
    expect(host.textContent).not.toContain("Session");
    expect(locationState()).toEqual({ target: null, room: null, rooms: [] });
    expect(choose).not.toHaveBeenCalled();
    await showLocation(false);
    resolveMetadata(targetResponse());
    await vi.waitFor(() =>
      expect(locationState()).toEqual({
        target: session,
        room,
        rooms: [{ id: room, name: "Main hall" }],
      }),
    );
    expect(host.textContent).toContain("Session");
    expect(host.textContent).toContain("Physical room");
    await showLocation(true);
    expect(locationState()).toEqual({ target: null, room: null, rooms: [] });
    await showLocation(false);
    // A legitimate check-in choice survives the mode switch before any replacement request finishes.
    expect(locationState()).toEqual({ target: session, room, rooms: [{ id: room, name: "Main hall" }] });
  });

  it("renders assigned duty times in the event zone and applies the session and physical room together", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/suggestions")
          ? response()
          : new Response(JSON.stringify({ sessions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }), {
              headers: { "content-type": "application/json" },
            }),
      ),
    );
    host = document.createElement("div");
    document.body.append(host);
    const selectRoom = vi.fn();
    await act(() =>
      render(
        <ScannerSetup
          slug="conference"
          operatorUserId={operator}
          sponsorOnly={false}
          explicitTarget={false}
          ready
          locked={false}
          targetId={null}
          label=""
          roomId={null}
          rooms={[]}
          targetField={{}}
          roomField={{}}
          onTarget={choose}
          onRoom={selectRoom}
        />,
        host,
      ),
    );
    await settle();
    expect(choose).toHaveBeenCalledExactlyOnceWith(candidate.occurrence);
    expect(selectRoom).toHaveBeenCalledExactlyOnceWith(room);
    await click("Choose session or room");
    await click("My shifts");
    const dialog = host.querySelector("dialog[open]");
    expect(dialog?.textContent).toContain("Europe/Amsterdam");
    expect(dialog?.textContent).toContain("11:00");
    expect(dialog?.textContent).toContain("Quantum readiness · Main hall");
  });

  it("prefills one unique target once after the pending outbox has been checked", async () => {
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    await mount({ ready: false });
    await click("Quantum readiness MC");
    expect(choose).not.toHaveBeenCalled();
    await update({ ready: true });
    expect(choose).toHaveBeenCalledExactlyOnceWith(candidate);
    await click("Refresh assignments");
    expect(choose).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it("combines compatible duties for the same target rather than creating artificial ambiguity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response([candidate, { ...candidate, shiftId: crypto.randomUUID(), roles: ["Remote questions"] }]),
      ),
    );
    await mount();
    expect(choose).toHaveBeenCalledOnce();
    expect(choose.mock.calls[0]![0].roles).toEqual(["MC", "Remote questions"]);
    expect(
      [...host.querySelectorAll("button")].filter((button) => button.textContent?.includes("Quantum readiness")),
    ).toHaveLength(1);
  });
  it.each(["explicit", "locked", "truncated", "parallel", "multiroom"])(
    "requires a deliberate choice for %s setup",
    async (kind) => {
      const other = { ...candidate, occurrence: { ...candidate.occurrence, id: crypto.randomUUID() } };
      const multiroom = {
        ...candidate,
        suggestedRoomId: null,
        occurrence: {
          ...candidate.occurrence,
          rooms: [...candidate.occurrence.rooms!, { id: crypto.randomUUID(), name: "Second hall" }],
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          response(
            kind === "parallel" ? [candidate, other] : [kind === "multiroom" ? multiroom : candidate],
            kind === "truncated",
          ),
        ),
      );
      await mount({ explicitTarget: kind === "explicit", locked: kind === "locked" });
      expect(choose).not.toHaveBeenCalled();
      await update({ locked: false });
      expect(choose).not.toHaveBeenCalled();
    },
  );
  it.each(["Event admission", "Choose room manually"])(
    "respects a manual %s choice before the request finishes",
    async (label) => {
      let resolve!: (value: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((done) => {
              resolve = done;
            }),
        ),
      );
      await mount();
      await click(label);
      choose.mockClear();
      resolve(response());
      await settle();
      expect(choose).not.toHaveBeenCalled();
    },
  );
  it("ignores a stale operator/event response even when transport ignores cancellation", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );
    await mount();
    await update({ slug: "another-event", operatorUserId: crypto.randomUUID() });
    resolvers[0]!(response());
    await settle();
    expect(choose).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Quantum readiness");
    resolvers[1]!(response());
    await settle();
    expect(choose).toHaveBeenCalledExactlyOnceWith(candidate);
  });
  it("skips duty discovery for sponsor-only scanners", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await mount({ enabled: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shows a recoverable failure without changing the target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    await mount();
    expect(host.textContent).toContain("Choose a session manually");
    expect(choose).not.toHaveBeenCalled();
  });
});
