// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
  detachLiveOverlayElements,
} from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_LAYOUT_NAME_MAX,
  LIVE_OVERLAY_PRESETS,
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  eventLiveOverlayPositionsPutSchema,
  type EventLiveOverlayLayoutsResponse,
} from "../../assets/shared/schemas/live-overlay-layout";
import { copyName } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/PreviewSceneEditor";
import { rebaseSharedPositions } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sharing";
import {
  useSceneDraft,
  type SceneDraft,
} from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/useSceneDraft";

const LAYOUTS = eventLiveOverlayLayoutsResponseSchema.parse({
  layouts: LIVE_OVERLAY_PRESETS.map((preset) => ({
    slug: preset,
    ...LIVE_OVERLAY_PRESET_LAYOUTS[preset],
    preset,
    builtIn: true,
    saved: false,
    updatedAt: null,
  })),
  positions: { elements: LIVE_OVERLAY_DEFAULT_POSITIONS, saved: false, updatedAt: null },
});
const POSITIONS_SAVED_AT = "2026-11-27T10:00:00.000Z";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

let puts: Array<{ url: string; body: { expectedUpdatedAt: string | null } }> = [];
let refuseScene = true;
let host: HTMLElement;
let draft: SceneDraft;
let finished: boolean[] = [];

/** Holds the stored scenes as an editor does, taking whatever a save hands back. */
function Editor() {
  const [saved, setSaved] = useState<EventLiveOverlayLayoutsResponse>(LAYOUTS);
  draft = useSceneDraft({
    endpoints: { layouts: "/api/layouts", positions: "/api/positions" },
    layout: saved.layouts[0]!,
    positions: saved.positions,
    onSaved: (next, done) => {
      finished.push(done);
      setSaved(next);
    },
  });
  return null;
}

beforeEach(() => {
  puts = [];
  finished = [];
  refuseScene = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const sent: unknown = JSON.parse(String(init?.body));
      if (url === "/api/positions") {
        const body = eventLiveOverlayPositionsPutSchema.parse(sent);
        puts.push({ url, body });
        return json({
          ...LAYOUTS,
          positions: { elements: body.elements, saved: true, updatedAt: POSITIONS_SAVED_AT },
        });
      }
      puts.push({ url, body: eventLiveOverlayLayoutPutSchema.parse(sent) });
      if (refuseScene) return json({ error: { message: "The scene could not be saved." } }, 500);
      return json(LAYOUTS);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  void act(() => render(<Editor />, host));
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe("saving a scene", () => {
  it("keeps the positions it saved when the scene then fails, so the next save sends their version", async () => {
    const lowerThird = draft.elements.lowerThird;
    // A shared graphic moved (the event's positions) and the scene renamed (the scene itself).
    await act(() => void draft.place("lowerThird", { ...lowerThird, y: lowerThird.y - 0.05 }));
    await act(() => draft.rename("Camera close"));
    await act(async () => void (await draft.save()));
    expect(finished).toEqual([false]);
    expect(draft.dirty).toBe(true);
    expect(draft.name).toBe("Camera close");
    // The positions are saved: the second save sends only the scene.
    refuseScene = false;
    puts = [];
    await act(async () => void (await draft.save()));
    expect(puts.map(({ url }) => url)).toEqual(["/api/layouts/" + LAYOUTS.layouts[0]!.slug]);
    expect(finished).toEqual([false, true]);
  });
});

describe("taking the event's shared positions saved elsewhere", () => {
  it("moves the scene's shared graphics with them and keeps a shared move the draft made", () => {
    const before = LIVE_OVERLAY_DEFAULT_POSITIONS;
    const elements = LAYOUTS.layouts[0]!.elements;
    const movedByDraft = { ...before.lowerThird, y: 0.1 };
    const drafts = {
      elements: {
        ...elements,
        lowerThird: { ...elements.lowerThird, ...movedByDraft, shared: true },
        chat: { ...elements.chat, ...before.chat, shared: true },
        ticker: { ...elements.ticker, ...before.ticker, shared: false },
      },
      positions: { ...before, lowerThird: movedByDraft },
    };
    const after = {
      ...before,
      lowerThird: { ...before.lowerThird, y: 0.6 },
      chat: { ...before.chat, x: 0.2 },
      ticker: { ...before.ticker, x: 0.3 },
    };
    const next = rebaseSharedPositions(drafts, before, after);
    expect(next.positions.lowerThird).toEqual(movedByDraft);
    expect(next.elements.lowerThird.y).toBe(0.1);
    expect(next.positions.chat).toEqual(after.chat);
    expect(next.elements.chat.x).toBe(0.2);
    // A graphic the scene places itself keeps its own box; every graphic keeps the scene's own fields.
    expect(next.elements.ticker).toEqual(drafts.elements.ticker);
    expect(next.elements.chat.visible).toBe(drafts.elements.chat.visible);
  });
});

describe("duplicating a scene", () => {
  it("names a copy within a scene name's length, its number included", () => {
    const long = "A".repeat(LIVE_OVERLAY_LAYOUT_NAME_MAX);
    const first = copyName(long, []);
    expect(first).toHaveLength(LIVE_OVERLAY_LAYOUT_NAME_MAX);
    const second = copyName(long, [{ ...LAYOUTS.layouts[0]!, name: first }]);
    expect(second).toHaveLength(LIVE_OVERLAY_LAYOUT_NAME_MAX);
    expect(second).toMatch(/ 2$/);
    expect(copyName("Camera", [])).toBe("Copy of Camera");
  });

  it("gives the copy's graphics places of their own, where the event shares them now", () => {
    const moved = {
      ...LIVE_OVERLAY_DEFAULT_POSITIONS,
      lowerThird: { ...LIVE_OVERLAY_DEFAULT_POSITIONS.lowerThird, y: 0.5 },
    };
    const copy = detachLiveOverlayElements(LAYOUTS.layouts[0]!.elements, moved);
    expect(Object.values(copy).every((placement) => !placement.shared)).toBe(true);
    expect(copy.lowerThird.y).toBe(0.5);
  });
});
