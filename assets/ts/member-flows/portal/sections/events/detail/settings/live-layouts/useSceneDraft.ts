import { useEffect, useRef, useState } from "preact/hooks";
import {
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  eventLiveOverlayPositionsPutSchema,
  type EventLiveOverlayLayoutsResponse,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayout,
  type LiveOverlayPositions,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import type { LiveProgramLayer } from "../../../../../../../../shared/live-overlay-stacking";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { putJson } from "../../../../../../../shared/api-client";
import type { LayoutSharingAction } from "./OverlayLayoutGraphics";
import type { Box } from "./overlay-layout-editing";
import { reorderSceneGraphic, sceneGraphics } from "./overlay-layout-graphics";
import { snapIntoSpot, spotTurnsFor, withSpotTurns } from "./overlay-layout-spots";
import {
  applyLayoutElementToAll,
  changeLayoutElement,
  layoutElementsChanged,
  relinkLayoutElement,
  unlinkLayoutElement,
  type LayoutDrafts,
} from "./overlay-layout-sharing";

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const SHARING: Record<LayoutSharingAction, (drafts: LayoutDrafts, element: LiveOverlayElement) => LayoutDrafts> = {
  unlink: unlinkLayoutElement,
  relink: relinkLayoutElement,
  apply: applyLayoutElementToAll,
};

/** The two resources a scene saves to: the scene itself, and the event's shared positions. */
export interface SceneEndpoints {
  /** The event's scenes; a scene saves under it by its slug. */
  layouts: string;
  positions: string;
}

/**
 * One scene's draft, as both scene editors keep it: the event settings
 * before the event, and Preview in the live studio. Every change stays a
 * draft until `save` writes the scene through the overlay-layout contract,
 * the shared positions first; `discard` puts the saved scene back. A save
 * hands back the stored scenes, and the draft starts again from them.
 */
export function useSceneDraft({
  endpoints,
  layout,
  positions: savedPositions,
  onSaved,
  onDirty,
}: {
  endpoints: SceneEndpoints;
  layout: LiveOverlayLayout;
  positions: LiveOverlayPositions;
  onSaved: (layouts: EventLiveOverlayLayoutsResponse) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(layout.name);
  const initial = (): LayoutDrafts => ({ elements: layout.elements, positions: savedPositions.elements });
  const [drafts, setDrafts] = useState<LayoutDrafts>(initial);
  const { elements } = drafts;
  const graphics = sceneGraphics(elements);
  const [picked, setPicked] = useState<LiveOverlayElement | null>(null);
  // The graphic picked, while the scene still shows it; else the one in front.
  const selected = picked && graphics.some((element) => element === picked) ? picked : (graphics[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef({ layout, savedPositions });
  latest.current = { layout, savedPositions };
  useEffect(() => {
    const current = latest.current;
    setName(current.layout.name);
    setDrafts({ elements: current.layout.elements, positions: current.savedPositions.elements });
  }, [layout.slug, layout.updatedAt, savedPositions.updatedAt]);
  const scene = { expectedUpdatedAt: layout.updatedAt, name, preset: layout.preset, elements };
  const [revealed, setRevealed] = useState(false);
  const form = useContractForm(eventLiveOverlayLayoutPutSchema, scene, {
    // A refused box opens the exact position of its graphic, so the field that says why is in view.
    revealField: (path) => {
      const element = /^elements\.([^.]+)\./.exec(path)?.[1] as LiveOverlayElement | undefined;
      if (!element) return;
      setPicked(element);
      setRevealed(true);
    },
  });
  const positionsChanged = (next: LayoutDrafts) => !same(next.positions, savedPositions.elements);
  const layoutChanged = (next: LayoutDrafts, nextName = name) =>
    nextName !== layout.name || layoutElementsChanged(next.elements, layout.elements);
  const dirty = layoutChanged(drafts) || positionsChanged(drafts);
  const update = (next: LayoutDrafts) => {
    setDrafts(next);
    setProblem(null);
    onDirty?.(layoutChanged(next) || positionsChanged(next));
  };
  const change = (element: LiveOverlayElement, patch: Partial<LiveOverlayElementPlacement>) =>
    update(changeLayoutElement(drafts, element, patch));
  // A board dropped mostly over another joins its spot and takes the spot's turns; one left on its own takes none.
  const place = (element: LiveOverlayElement, box: Box) => {
    const placed = changeLayoutElement(drafts, element, snapIntoSpot(drafts.elements, element, box));
    update(changeLayoutElement(placed, element, { turns: spotTurnsFor(placed.elements, element) }));
  };

  async function save(): Promise<boolean> {
    if (busy) return false;
    const checked = form.submit();
    if (!checked.data) {
      setProblem(checked.formMessage);
      return false;
    }
    setBusy(true);
    try {
      // The shared positions first: the scene's shared graphics take them, so a failed scene save loses nothing.
      let saved: EventLiveOverlayLayoutsResponse | null = null;
      if (positionsChanged(drafts))
        saved = await putJson(
          endpoints.positions,
          eventLiveOverlayPositionsPutSchema.parse({
            expectedUpdatedAt: savedPositions.updatedAt,
            elements: drafts.positions,
          }),
          eventLiveOverlayLayoutsResponseSchema,
        );
      if (layoutChanged(drafts))
        saved = await putJson(
          `${endpoints.layouts}/${encodeURIComponent(layout.slug)}`,
          checked.data,
          eventLiveOverlayLayoutsResponseSchema,
        );
      form.reset();
      if (saved) onSaved(saved);
      onDirty?.(false);
      return true;
    } catch (cause) {
      setProblem(form.refuse(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function discard() {
    setName(layout.name);
    setDrafts(initial());
    form.reset();
    setProblem(null);
    onDirty?.(false);
  }

  return {
    name,
    /** Renames the draft; saved with the scene. */
    rename: (next: string) => {
      setName(next);
      setProblem(null);
      onDirty?.(layoutChanged(drafts, next) || positionsChanged(drafts));
    },
    drafts,
    elements,
    graphics,
    selected,
    select: setPicked,
    /** Whether a refused field asked for the selected graphic's exact position to open. */
    revealed,
    setRevealed,
    scene,
    form,
    busy,
    setBusy,
    problem,
    setProblem,
    dirty,
    change,
    place,
    /** Lets a spot's boards take turns every `turns` seconds, or shows only its front one (null). */
    spotTurns: (element: LiveProgramLayer, turns: number | null) =>
      update({ ...drafts, elements: withSpotTurns(elements, element, turns) }),
    /** Holds a graphic's box in place on the canvas, or frees it. */
    lock: (element: LiveOverlayElement, locked: boolean) => change(element, { locked: locked || undefined }),
    share: (element: LiveOverlayElement, action: LayoutSharingAction) => update(SHARING[action](drafts, element)),
    /** Adds a graphic at its shared position, where the event's other scenes put it, or takes it out. */
    show: (element: LiveOverlayElement, visible: boolean) => {
      if (!visible) {
        change(element, { visible });
        return;
      }
      update(changeLayoutElement(relinkLayoutElement(drafts, element), element, { visible }));
      setPicked(element);
    },
    reorder: (element: LiveProgramLayer, to: number) =>
      update({ ...drafts, elements: reorderSceneGraphic(elements, element, to) }),
    save,
    discard,
  };
}

export type SceneDraft = ReturnType<typeof useSceneDraft>;
