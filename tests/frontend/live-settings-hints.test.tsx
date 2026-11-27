// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
} from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_PRESETS,
  eventLiveOverlayLayoutsResponseSchema,
} from "../../assets/shared/schemas/live-overlay-layout";
import { EventLiveSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EventLiveSettings";

/* Settings › Studio shows its hints as the studio does: no element keeps a native title, in any state. */

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
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

let root: HTMLElement | null = null;
beforeEach(() => {
  history.replaceState(null, "", "/portal/#/events/conference/settings/live?layout=questions");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/participation/program")
        ? json({ agenda: null, marks: [], availability: [] })
        : json(LAYOUTS),
    ),
  );
});
afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
    root = null;
  }
  vi.unstubAllGlobals();
});

/** Elements a browser would give its own title bubble; an iframe's title is its name, not a hint. */
const nativeTitles = () => [...document.querySelectorAll("[title]")].filter((element) => element.tagName !== "IFRAME");
const labeled = (label: string) => root!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const itemLabel = (item: Element) =>
  (item.querySelector(".pk-menu__text > span:first-child") ?? item).textContent!.replace(/^✓/, "");

it("leaves no native title on the page, in a menu or in a dialog, and hints the scene editor's controls", async () => {
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<EventLiveSettings slug="conference" canEdit />, root!));
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(root!.querySelector(".pk-layout-canvas")).not.toBeNull();
  });
  // The layer takes the titles once its effect has run, a frame after the page is drawn.
  await vi.waitFor(() => expect(nativeTitles()).toEqual([]));
  expect(labeled("Move Lower third up").dataset.tooltip).toBe("Move Lower third up\nOne step toward the front.");
  const box = root.querySelector<HTMLButtonElement>('button[data-element="topQuestions"]')!;
  expect(box.dataset.tooltip).toMatch(/^Top questions · .+\nDrag to move it/);
  // The canvas points each box at its own help, which stays the box's description.
  expect(box.getAttribute("aria-describedby")).not.toBeNull();
  const choice = root.querySelector<HTMLButtonElement>(
    '.pk-scenes__row[data-element="topQuestions"] .pk-scenes__switch button',
  )!;
  // The switch is a toggle whose hint says what it does now and what a click does.
  expect(choice.dataset.tooltip).toMatch(/^Comes on with the scene\n.+\nClick: switched in the studio\.$/);
  await act(() => choice.click());
  expect(choice.getAttribute("aria-pressed")).toBe("false");
  expect(nativeTitles()).toEqual([]);
  await act(() => labeled("Actions for Top questions").click());
  // A menu item whose effect its label does not say carries a hint; a plain one such as Remove does not.
  const hints = Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
      itemLabel(item),
      item.dataset.tooltip,
    ]),
  );
  expect(hints["Place differently on this scene"] ?? hints["Use shared position"]).toMatch(/position/);
  expect(hints["Remove from scene"]).toBeUndefined();
  expect(nativeTitles()).toEqual([]);
  await act(() => [...root!.querySelectorAll("button")].find((button) => button.textContent === "New scene")!.click());
  expect(document.querySelector("dialog[open]")).not.toBeNull();
  expect(nativeTitles()).toEqual([]);
});
