import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { liveOverlayDrawn } from "../../../../../../../../shared/live-overlay-cover";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_STANDARD_ELEMENTS,
  detachLiveOverlayElements,
} from "../../../../../../../../shared/live-overlay-layout-presets";
import { isLiveProgramLayer } from "../../../../../../../../shared/live-overlay-stacking";
import {
  LIVE_OVERLAY_LAYOUT_NAME_MAX,
  eventLiveOverlayLayoutsResponseSchema,
  type EventLiveOverlayLayoutsResponse,
  type LiveOverlayElement,
  type LiveOverlayLayout,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { ErrorAlert } from "../../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../../components/Spinner";
import { useData } from "../../../../../../../hooks/useData";
import { getJson, putJson } from "../../../../../../../shared/api-client";
import { toast } from "../../../../../ui";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Dialog } from "../../../../../../../ui/Dialog";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { OverlayLayoutCanvas } from "../../settings/live-layouts/OverlayLayoutCanvas";
import { AddGraphicMenu, LockIcon, OverlayLayoutGraphics } from "../../settings/live-layouts/OverlayLayoutGraphics";
import { layoutSlugFor } from "../../settings/live-layouts/overlay-layout-slug";
import { useSceneDraft, type SceneDraft, type SceneEndpoints } from "../../settings/live-layouts/useSceneDraft";
import { previewSceneOf } from "./SceneChoices";
import { useHoldUnsavedScene } from "./useHoldUnsavedScene";
import "./PreviewSceneEditor.css";

/** Whether Preview is unlocked to edit its scene, in this browser; one Preview at a time across the studio. */
export const previewSceneEditing = signal(false);

/** An arrow turning back: put the saved scene back. */
function UndoIcon() {
  return (
    <StrokeIcon>
      <path d="M5.5 3 2.5 6l3 3" />
      <path d="M2.5 6h7a4 4 0 0 1 0 8H7" />
    </StrokeIcon>
  );
}

/** A disk: save the scene. */
function SaveIcon() {
  return (
    <StrokeIcon>
      <path d="M2.5 2.5h9l2 2v9h-11z" />
      <path d="M5 2.5v3.5h5V2.5M5 13.5V9.5h6v4" />
    </StrokeIcon>
  );
}

/** The draft open on Preview, read when someone leaves it; held outside render so leaving never redraws it. */
const openDraft: { current: SceneDraft | null } = { current: null };
/** Asks to save or discard the open draft; answered with whether Preview may leave it. */
const leavingDraft = signal<((leave: boolean) => void) | null>(null);

/**
 * Leaves the scene Preview is editing (locked, another scene, or cleared),
 * then goes on: at once without unsaved changes; with them, once someone
 * saved or discarded them. Kept editing, it does not go on.
 */
export function leavePreviewScene(go: () => void): void {
  if (!previewSceneEditing.value || !openDraft.current?.dirty) return go();
  leavingDraft.value?.(false);
  leavingDraft.value = (leave) => leave && go();
}

const endpointsOf = (slug: string): SceneEndpoints => {
  const event = `/api/v1/events/${encodeURIComponent(slug)}/settings/live`;
  return { layouts: `${event}/layouts`, positions: `${event}/positions` };
};

/** The scene being edited on Preview: still loading, refused, or its draft. */
type SceneEditing =
  | { status: "loading" }
  | { status: "failed"; error: string }
  | { status: "ready"; draft: SceneDraft; layout: LiveOverlayLayout; preview: LiveRoomState };

const SceneEditingContext = createContext<SceneEditing | null>(null);

/** The scene being edited on Preview, for Preview's canvas and the Graphics panel; null while Preview is locked. */
export const useSceneEditing = () => useContext(SceneEditingContext);

/** What the draft holds before the scene loads: nothing an operator sees, never saved. */
const NOT_LOADED: { layout: LiveOverlayLayout; saved: EventLiveOverlayLayoutsResponse } = {
  layout: {
    slug: "",
    name: "",
    preset: null,
    builtIn: false,
    saved: false,
    updatedAt: null,
    elements: LIVE_OVERLAY_STANDARD_ELEMENTS,
  },
  saved: { layouts: [], positions: { elements: LIVE_OVERLAY_DEFAULT_POSITIONS, saved: false, updatedAt: null } },
};

/**
 * Holds the one draft of the scene on Preview while it is unlocked, so
 * Preview's canvas and the Graphics panel's sources list edit the same
 * scene. Locked, it holds nothing and loads nothing. The studio under it
 * stays mounted as Preview locks and unlocks: only what it provides changes.
 */
export function SceneEditingProvider({
  slug,
  preview,
  canEdit,
  children,
}: {
  slug: string;
  preview: LiveRoomState;
  canEdit: boolean;
  children: ComponentChildren;
}) {
  const editing = canEdit && previewSceneEditing.value;
  const endpoints = endpointsOf(slug);
  const { current } = previewSceneOf(preview);
  // The scene the draft edits: Preview's, except while changes to the one before wait to be saved or discarded.
  const [sceneSlug, setSceneSlug] = useState(current.slug);
  const [saved, setSaved] = useState<EventLiveOverlayLayoutsResponse | null>(null);
  const layout = saved?.layouts.find((candidate) => candidate.slug === sceneSlug);
  // A scene copied since the scenes loaded is read again, never stood in for by another.
  const missing = saved && !layout ? sceneSlug : "";
  const loaded = useData(
    () =>
      editing
        ? getJson(endpoints.layouts, eventLiveOverlayLayoutsResponseSchema).then((read) => ({ read, missing }))
        : Promise.resolve(null),
    [slug, editing, missing],
  );
  useEffect(() => {
    if (loaded.data) setSaved(loaded.data.read);
  }, [loaded.data]);
  const draft = useSceneDraft({
    endpoints,
    layout: layout ?? NOT_LOADED.layout,
    positions: (saved ?? NOT_LOADED.saved).positions,
    onSaved: (next, done) => {
      setSaved(next);
      if (done) toast("Scene saved. Every room shows the change.", "success");
    },
  });
  useEffect(() => {
    if (current.slug === sceneSlug) return;
    if (!draft.dirty) return setSceneSlug(current.slug);
    // Someone put another scene on Preview: this one's changes are saved or discarded first.
    leavingDraft.value ??= (leave) => leave && setSceneSlug(current.slug);
  }, [current.slug, sceneSlug, draft.dirty]);
  const value: SceneEditing | null = !editing
    ? null
    : loaded.error
      ? { status: "failed", error: loaded.error }
      : !saved || loaded.loading || (layout && draft.draftOf !== layout.slug)
        ? { status: "loading" }
        : layout
          ? { status: "ready", draft, layout, preview }
          : loaded.data?.missing === sceneSlug
            ? { status: "failed", error: "This scene is no longer saved for the event." }
            : { status: "loading" };
  openDraft.current = value?.status === "ready" ? draft : null;
  useEffect(() => {
    if (value?.status === "ready") return;
    // Locked or not loaded: nothing waits to be saved.
    leavingDraft.value?.(false);
    leavingDraft.value = null;
  }, [value?.status]);
  useEffect(
    () => () => {
      openDraft.current = null;
    },
    [],
  );
  const unsaved = value?.status === "ready" && draft.dirty;
  useHoldUnsavedScene(unsaved, leavePreviewScene);
  return (
    <SceneEditingContext.Provider value={value}>
      {children}
      {value?.status === "ready" && leavingDraft.value ? <SaveOrDiscard draft={draft} /> : null}
    </SceneEditingContext.Provider>
  );
}

/**
 * The first free name for a copy of a scene: "Copy of Camera", then "Copy of
 * Camera 2". A long name is cut short so the copy's name, number included,
 * still fits a scene name.
 */
export function copyName(name: string, layouts: readonly LiveOverlayLayout[]) {
  const taken = new Set(layouts.map((layout) => layout.name));
  const named = (count: number) => {
    const suffix = count > 1 ? ` ${count}` : "";
    return `${`Copy of ${name}`.slice(0, LIVE_OVERLAY_LAYOUT_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  };
  let count = 1;
  while (taken.has(named(count))) count += 1;
  return named(count);
}

/**
 * Copy, then edit: saves the scene on Preview as a new scene, puts the copy
 * on Preview and unlocks it, so the original stays as it is in every room.
 */
export function duplicatePreviewScene(slug: string, preview: LiveRoomState, onPreviewScene: (scene: string) => void) {
  leavePreviewScene(() => void copyPreviewScene(slug, preview, onPreviewScene));
}

async function copyPreviewScene(slug: string, preview: LiveRoomState, onPreviewScene: (scene: string) => void) {
  const endpoint = endpointsOf(slug).layouts;
  try {
    const { layouts, positions } = await getJson(endpoint, eventLiveOverlayLayoutsResponseSchema);
    const { current } = previewSceneOf(preview);
    const from = layouts.find((layout) => layout.slug === current.slug);
    if (!from) throw new Error("The scene on Preview is no longer there.");
    const name = copyName(from.name, layouts);
    const created = layoutSlugFor(name, new Set(layouts.map((layout) => layout.slug)));
    await putJson(
      `${endpoint}/${encodeURIComponent(created)}`,
      // The copy's graphics have places of their own, so moving one never moves it in the original.
      {
        expectedUpdatedAt: null,
        name,
        preset: from.preset,
        elements: detachLiveOverlayElements(from.elements, positions.elements),
      },
      eventLiveOverlayLayoutsResponseSchema,
    );
    onPreviewScene(created);
    previewSceneEditing.value = true;
    toast(`${name} is on Preview to edit.`, "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not copy the scene.", "error");
  }
}

/** Save or discard the scene's changes before Preview leaves it; Keep editing stays. */
function SaveOrDiscard({ draft }: { draft: SceneDraft }) {
  const settle = (leave: boolean) => {
    leavingDraft.value?.(leave);
    leavingDraft.value = null;
  };
  return (
    <Dialog
      open
      title={`Save changes to ${draft.name}?`}
      description="Saving changes this scene in every room of the event."
      confirmLabel="Save scene"
      onConfirm={() => undefined}
      onCancel={() => settle(false)}
      footerActions={
        <>
          <Button variant="ghost" disabled={draft.busy} onClick={() => settle(false)}>
            Keep editing
          </Button>
          <Button
            variant="ghost"
            disabled={draft.busy}
            onClick={() => {
              draft.discard();
              settle(true);
            }}
          >
            Discard changes
          </Button>
          <Button
            variant="primary"
            loading={draft.busy}
            onClick={() => void draft.save().then((saved) => saved && settle(true))}
          >
            Save scene
          </Button>
        </>
      }
    >
      {draft.problem ? <Alert tone="danger">{draft.problem}</Alert> : null}
    </Dialog>
  );
}

/** The scene's Discard and Save, as icons in Preview's header while it is unlocked; the words are their tooltips. */
export function PreviewSceneSave() {
  const editing = useSceneEditing();
  if (editing?.status !== "ready") return null;
  const { draft } = editing;
  return (
    <span class="pk-studio-scene-editor__actions">
      <Button
        icon
        variant="ghost"
        aria-label="Discard changes"
        title={"Discard changes\nPut this scene back as it was saved."}
        disabled={draft.busy || !draft.dirty}
        onClick={draft.discard}
      >
        <UndoIcon />
      </Button>
      <Button
        icon
        variant={draft.dirty ? "primary" : "ghost"}
        aria-label="Save scene"
        title={"Save scene\nChanges this scene in every room of the event. To keep it as it is, duplicate it first."}
        loading={draft.busy}
        disabled={!draft.dirty}
        onClick={() => void draft.save()}
      >
        <SaveIcon />
      </Button>
    </span>
  );
}

/** The padlock beside Preview's code that unlocks its scene for editing, and locks it again. */
export function PreviewSceneLock({ disabled }: { disabled: boolean }) {
  const open = previewSceneEditing.value;
  return (
    <Button
      icon
      variant="ghost"
      aria-pressed={open}
      aria-label={open ? "Lock scene" : "Unlock scene"}
      title={
        open
          ? "Lock scene\nStop editing this scene."
          : "Unlock to edit this scene\nMove and resize its graphics on Preview. Program is not touched."
      }
      disabled={disabled}
      onClick={() => {
        if (!open) previewSceneEditing.value = true;
        else leavePreviewScene(() => (previewSceneEditing.value = false));
      }}
    >
      <LockIcon open={open} />
    </Button>
  );
}

/**
 * Preview unlocked: the scene drawn with the room's real content, a box
 * over each of its graphics to drag and resize, and the graphics that are
 * off as outlines. Program is never touched.
 */
export function PreviewSceneCanvas() {
  const editing = useSceneEditing();
  if (!editing || editing.status === "loading") return <Spinner label="Loading the scene…" />;
  if (editing.status === "failed") return <ErrorAlert error={editing.error} />;
  const { draft, preview } = editing;
  // A graphic the scene includes that has nothing on air in Preview is drawn as its outline.
  const off = (element: LiveOverlayElement) => isLiveProgramLayer(element) && !liveOverlayDrawn(preview.stage, element);
  return (
    <div class="pk-studio-scene-editor">
      <OverlayLayoutCanvas
        elements={draft.elements}
        shown={draft.graphics}
        selected={draft.selected}
        projection={preview}
        off={off}
        bar={false}
        caption={null}
        safeAreas
        onSafeAreas={() => undefined}
        onSelect={draft.select}
        onChange={draft.place}
      />
      {draft.problem ? <Alert tone="danger">{draft.problem}</Alert> : null}
    </div>
  );
}

/** The scene's sources while Preview is unlocked: add, take out, reorder, and how each takes its position. */
export function SceneSourcesList({ draft }: { draft: SceneDraft }) {
  return (
    <div class="pk-scenes__graphics">
      <div class="pk-studio-scene-sources__bar">
        <span class="pk-small pk-muted" title="Saving changes this scene in every room of the event.">
          {draft.dirty ? `${draft.name} · unsaved` : draft.name}
        </span>
        <AddGraphicMenu elements={draft.elements} disabled={draft.busy} onShow={draft.show} />
      </div>
      <OverlayLayoutGraphics
        framed={false}
        elements={draft.elements}
        selected={draft.selected}
        disabled={draft.busy}
        onSelect={draft.select}
        onShow={draft.show}
        onComesOn={(element, comesOn) => draft.change(element, { comesOn })}
        onReorder={draft.reorder}
        onSharing={draft.share}
        onTurns={draft.spotTurns}
        onLock={draft.lock}
      />
    </div>
  );
}
