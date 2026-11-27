// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
} from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_PRESETS,
  eventLiveOverlayLayoutsResponseSchema,
} from "../../assets/shared/schemas/live-overlay-layout";
import { previewSceneEditing } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/PreviewSceneEditor";
import { liveSnapshot } from "./helpers/live-room-socket";
import {
  OPERATOR,
  button,
  commands,
  labeled,
  mountDesk,
  panel,
  resetDeskStorage,
  unmountDesks,
} from "./helpers/live-desk";

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
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
/** The scenes another operator's copy adds, read once the studio asks again. */
const COPIED = eventLiveOverlayLayoutsResponseSchema.parse({
  ...LAYOUTS,
  layouts: [
    ...LAYOUTS.layouts,
    { ...LAYOUTS.layouts[0]!, slug: "copy-of-camera", name: "Copy of Camera", builtIn: false },
  ],
});
let saves: string[] = [];
let reads = 0;
/** While set, a save waits for it before the server answers. */
let held: Promise<void> | null = null;

beforeEach(() => {
  resetDeskStorage();
  saves = [];
  reads = 0;
  held = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/settings/live/layouts") || url.includes("/settings/live/positions")) {
        if (init?.method === "PUT") {
          saves.push(url);
          await held;
          // The server answers with what it saved, so the saved positions are the ones sent.
          if (url.endsWith("/positions")) {
            const { elements } = JSON.parse(String(init.body)) as { elements: typeof LAYOUTS.positions.elements };
            return json({ ...LAYOUTS, positions: { ...LAYOUTS.positions, elements, saved: true } });
          }
        } else if (url.endsWith("/layouts")) reads += 1;
        return json(reads > 1 ? COPIED : LAYOUTS);
      }
      return json({ error: { message: "Not here" } }, 404);
    }),
  );
});
afterEach(() => {
  previewSceneEditing.value = false;
  unmountDesks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mounts the studio for someone who sets it up, with Preview's scene unlocked and a graphic moved. */
async function editedPreview() {
  const desk = mountDesk(liveSnapshot({ viewer: OPERATOR }), "show", undefined, true, true);
  const preview = panel(desk.host, "Preview");
  await act(() => labeled(preview, "Unlock scene").click());
  const box = await vi.waitFor(() => {
    const found = preview.querySelector<HTMLElement>(
      '.pk-studio-scene-editor .pk-layout-canvas__box[data-element="lowerThird"]',
    );
    if (!found) throw new Error("No box on Preview yet");
    return found;
  });
  await act(() => void box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
  await vi.waitFor(() => expect(labeled(preview, "Save scene").disabled).toBe(false));
  return { ...desk, preview };
}
const sceneButton = (preview: HTMLElement, name: string) =>
  [...preview.querySelectorAll<HTMLButtonElement>('[aria-label="Load a scene into Preview"] button')].find(
    (scene) => scene.querySelector(".pk-studio-scene__name")?.textContent === name,
  )!;
const previewSets = (live: Parameters<typeof commands>[0]) =>
  commands(live).filter((message) => message.type === "preview.set");
/** Another operator puts this scene on the shared Preview. */
const previewElsewhere = (live: Parameters<typeof commands>[0], scene: string) => {
  const snapshot = liveSnapshot({ viewer: OPERATOR });
  // The room knows every saved scene, the copy included, as soon as it is saved.
  const overlayLayouts = COPIED.layouts.map(({ slug, name, preset, elements }) => ({ slug, name, preset, elements }));
  return act(() => live.latest().deliver({ ...snapshot, overlayLayouts, preview: { ...snapshot.preview, scene } }));
};
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]");
const pointer = (target: Element, type: string, clientX: number, clientY: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerId: 1,
    isPrimary: true,
    button: 0,
    altKey: false,
    clientX,
    clientY,
  }))
    Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
};
/** Drags from one point of the canvas to another and lets go. */
const drag = (target: Element, [x, y]: [number, number], [toX, toY]: [number, number]) =>
  act(() => {
    pointer(target, "pointerdown", x, y);
    pointer(target, "pointermove", toX, toY);
    pointer(target, "pointerup", toX, toY);
  });
const boxAt = (box: HTMLElement) =>
  ["--box-x", "--box-y", "--box-w", "--box-h"].map((key) => box.style.getPropertyValue(key));

describe("editing the scene on Preview", () => {
  it("asks to save or discard unsaved changes before Preview loads another scene, and stays on Keep editing", async () => {
    const { preview, live } = await editedPreview();
    const before = previewSets(live).length;
    await act(() => sceneButton(preview, "Full board").click());
    expect(dialog()?.textContent).toContain("Saving changes this scene in every room of the event.");
    expect(previewSets(live)).toHaveLength(before);
    await act(() => button(dialog()!, "Keep editing").click());
    expect(dialog()).toBeNull();
    expect(previewSets(live)).toHaveLength(before);
    expect(previewSceneEditing.value).toBe(true);
    // Discarded, Preview goes on to the scene, and nothing is saved.
    await act(() => sceneButton(preview, "Full board").click());
    await act(() => button(dialog()!, "Discard changes").click());
    expect(previewSets(live).at(-1)).toMatchObject({ composition: { scene: "full-board" } });
    expect(saves).toEqual([]);
  });

  it("saves the changes for every room before it locks the scene", async () => {
    const { preview } = await editedPreview();
    await act(() => labeled(preview, "Lock scene").click());
    await act(async () => button(dialog()!, "Save scene").click());
    await vi.waitFor(() => expect(previewSceneEditing.value).toBe(false));
    expect(saves.length).toBeGreaterThan(0);
  });

  it("locks at once when nothing changed", async () => {
    const desk = mountDesk(liveSnapshot({ viewer: OPERATOR }), "show", undefined, true, true);
    const preview = panel(desk.host, "Preview");
    expect(preview.querySelector('[aria-label^="Full screen"]')).not.toBeNull();
    await act(() => labeled(preview, "Unlock scene").click());
    // The studio stays mounted as Preview unlocks: the same panel now offers to lock.
    expect(preview.isConnected).toBe(true);
    // The canvas stands in for the picture, so there is no picture to show full screen.
    expect(preview.querySelector('[aria-label^="Full screen"]')).toBeNull();
    await act(() => labeled(preview, "Lock scene").click());
    expect(dialog()).toBeNull();
    expect(previewSceneEditing.value).toBe(false);
    expect(preview.querySelector('[aria-label^="Full screen"]')).not.toBeNull();
  });

  it("asks to save or discard before following another operator's scene on Preview", async () => {
    const { live } = await editedPreview();
    await previewElsewhere(live, "full-board");
    expect(dialog()?.textContent).toContain("Saving changes this scene in every room of the event.");
    await act(() => button(dialog()!, "Discard changes").click());
    expect(dialog()).toBeNull();
    expect(saves).toEqual([]);
  });

  it("reads the scenes again for a scene copied since they loaded, and edits that one", async () => {
    const desk = mountDesk(liveSnapshot({ viewer: OPERATOR }), "show", undefined, true, true);
    const preview = panel(desk.host, "Preview");
    await act(() => labeled(preview, "Unlock scene").click());
    await vi.waitFor(() => expect(reads).toBe(1));
    await previewElsewhere(desk.live, "copy-of-camera");
    await vi.waitFor(() => expect(reads).toBe(2));
    await vi.waitFor(() =>
      expect(preview.querySelector(".pk-studio-scene-editor .pk-layout-canvas__box")).not.toBeNull(),
    );
    expect(preview.textContent).not.toContain("no longer saved");
  });

  it("puts a box dragged or resized while the scene saves back where it was, and edits again once saved", async () => {
    // The canvas has a size to drag across, and each drag frame draws at once.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 960, 540));
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => (frame(0), 1));
    const { preview } = await editedPreview();
    let answer!: () => void;
    held = new Promise((resolve) => (answer = resolve));
    await act(() => labeled(preview, "Save scene").click());
    await vi.waitFor(() => expect(saves.length).toBeGreaterThan(0));
    const box = preview.querySelector<HTMLElement>(
      '.pk-studio-scene-editor .pk-layout-canvas__box[data-element="lowerThird"]',
    )!;
    const before = boxAt(box);
    await drag(box, [200, 450], [400, 300]);
    expect(boxAt(box)).toEqual(before);
    const corner = box.querySelector(".pk-layout-canvas__handle")!;
    await drag(corner, [200, 450], [120, 380]);
    expect(boxAt(box)).toEqual(before);
    await act(async () => answer());
    await vi.waitFor(() => expect(labeled(preview, "Save scene").disabled).toBe(true));
    // Saved, the scene takes changes again.
    await act(() => void box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    await vi.waitFor(() => expect(labeled(preview, "Save scene").disabled).toBe(false));
  });

  it("puts the studio's address back and asks to save or discard before going to another portal page", async () => {
    const go = (hash: string) => {
      const oldURL = location.href;
      history.pushState(null, "", hash);
      dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }));
    };
    await editedPreview();
    const studio = location.hash.split("?", 1)[0]!;
    // A tab in the studio's own address is not leaving.
    await act(() => go(`${studio}?graphics=other`));
    expect(dialog()).toBeNull();
    await act(() => go("#/events/pqc-2026"));
    expect(location.hash).toBe(`${studio}?graphics=other`);
    expect(dialog()?.textContent).toContain("Saving changes this scene in every room of the event.");
    await act(() => button(dialog()!, "Keep editing").click());
    expect(location.hash).toBe(`${studio}?graphics=other`);
    await act(() => go("#/events/pqc-2026"));
    await act(() => button(dialog()!, "Discard changes").click());
    expect(location.hash).toBe("#/events/pqc-2026");
    expect(saves).toEqual([]);
  });
});
