import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { liveOverlayDrawn } from "../../../../../../../../shared/live-overlay-cover";
import { isLiveProgramLayer } from "../../../../../../../../shared/live-overlay-stacking";
import {
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
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { OverlayLayoutCanvas } from "../../settings/live-layouts/OverlayLayoutCanvas";
import { AddGraphicMenu, OverlayLayoutGraphics } from "../../settings/live-layouts/OverlayLayoutGraphics";
import { layoutSlugFor } from "../../settings/live-layouts/overlay-layout-slug";
import { useSceneDraft, type SceneDraft, type SceneEndpoints } from "../../settings/live-layouts/useSceneDraft";
import { previewSceneOf } from "./SceneChoices";
import "./PreviewSceneEditor.css";

/** Whether Preview is unlocked to edit its scene, in this browser; one Preview at a time across the studio. */
export const previewSceneEditing = signal(false);

/** A padlock, open while Preview is unlocked for editing. */
export function LockIcon({ open }: { open: boolean }) {
  return (
    <StrokeIcon>
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d={open ? "M5.5 7V4.8a2.5 2.5 0 0 1 4.9-.7" : "M5.5 7V4.8a2.5 2.5 0 0 1 5 0V7"} />
    </StrokeIcon>
  );
}

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

/**
 * Holds the one draft of the scene on Preview while it is unlocked, so
 * Preview's canvas and the Graphics panel's sources list edit the same
 * scene. Locked, it holds nothing and loads nothing.
 */
export function SceneEditingProvider({
  slug,
  preview,
  canEdit,
  onScenesSaved,
  children,
}: {
  slug: string;
  preview: LiveRoomState;
  canEdit: boolean;
  /** Tells this room the event's scenes were saved, so it shows the saved scene at once. */
  onScenesSaved: () => void;
  children: ComponentChildren;
}) {
  if (!canEdit || !previewSceneEditing.value)
    return <SceneEditingContext.Provider value={null}>{children}</SceneEditingContext.Provider>;
  return (
    <LoadedSceneEditing slug={slug} preview={preview} onScenesSaved={onScenesSaved}>
      {children}
    </LoadedSceneEditing>
  );
}

/** The first free name for a copy of a scene: "Copy of Camera", then "Copy of Camera 2". */
function copyName(name: string, layouts: readonly LiveOverlayLayout[]) {
  const taken = new Set(layouts.map((layout) => layout.name));
  const base = `Copy of ${name}`;
  let candidate = base;
  for (let count = 2; taken.has(candidate); count += 1) candidate = `${base} ${count}`;
  return candidate;
}

/**
 * Copy, then edit: saves the scene on Preview as a new scene, puts the copy
 * on Preview and unlocks it, so the original stays as it is in every room.
 */
export async function duplicatePreviewScene(
  slug: string,
  preview: LiveRoomState,
  onPreviewScene: (scene: string) => void,
) {
  const endpoint = endpointsOf(slug).layouts;
  try {
    const { layouts } = await getJson(endpoint, eventLiveOverlayLayoutsResponseSchema);
    const { current } = previewSceneOf(preview);
    const from = layouts.find((layout) => layout.slug === current.slug);
    if (!from) throw new Error("The scene on Preview is no longer there.");
    const name = copyName(from.name, layouts);
    const created = layoutSlugFor(name, new Set(layouts.map((layout) => layout.slug)));
    await putJson(
      `${endpoint}/${encodeURIComponent(created)}`,
      { expectedUpdatedAt: null, name, preset: from.preset, elements: from.elements },
      eventLiveOverlayLayoutsResponseSchema,
    );
    onPreviewScene(created);
    previewSceneEditing.value = true;
    toast(`${name} is on Preview to edit.`, "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not copy the scene.", "error");
  }
}

function LoadedSceneEditing({
  slug,
  preview,
  onScenesSaved,
  children,
}: {
  slug: string;
  preview: LiveRoomState;
  onScenesSaved: () => void;
  children: ComponentChildren;
}) {
  const endpoints = endpointsOf(slug);
  const loaded = useData(() => getJson(endpoints.layouts, eventLiveOverlayLayoutsResponseSchema), [slug]);
  const [saved, setSaved] = useState<EventLiveOverlayLayoutsResponse | null>(null);
  useEffect(() => {
    if (loaded.data) setSaved(loaded.data);
  }, [loaded.data]);
  const value: SceneEditing | null = loaded.error
    ? { status: "failed", error: loaded.error }
    : saved
      ? null
      : { status: "loading" };
  if (value || !saved) return <SceneEditingContext.Provider value={value}>{children}</SceneEditingContext.Provider>;
  const { current } = previewSceneOf(preview);
  const layout = saved.layouts.find((candidate) => candidate.slug === current.slug) ?? saved.layouts[0]!;
  return (
    <ReadySceneEditing
      endpoints={endpoints}
      saved={saved}
      layout={layout}
      preview={preview}
      onSaved={(next) => {
        setSaved(next);
        onScenesSaved();
        toast("Scene saved. Every room shows the change.", "success");
      }}
    >
      {children}
    </ReadySceneEditing>
  );
}

function ReadySceneEditing({
  endpoints,
  saved,
  layout,
  preview,
  onSaved,
  children,
}: {
  endpoints: SceneEndpoints;
  saved: EventLiveOverlayLayoutsResponse;
  layout: LiveOverlayLayout;
  preview: LiveRoomState;
  onSaved: (next: EventLiveOverlayLayoutsResponse) => void;
  children: ComponentChildren;
}) {
  const draft = useSceneDraft({ endpoints, layout, positions: saved.positions, onSaved });
  return (
    <SceneEditingContext.Provider value={{ status: "ready", draft, layout, preview }}>
      {children}
    </SceneEditingContext.Provider>
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
      onClick={() => (previewSceneEditing.value = !open)}
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
    <div class="pk-studio-scene-sources pk-scenes__graphics">
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
      />
    </div>
  );
}
