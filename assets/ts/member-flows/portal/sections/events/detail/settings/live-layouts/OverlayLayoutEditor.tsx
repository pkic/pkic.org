import { useEffect, useRef, useState } from "preact/hooks";
import {
  LIVE_OVERLAY_PRESET_LAYOUTS,
  resolveLiveOverlayElements,
} from "../../../../../../../../shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  eventLiveOverlayPositionsPutSchema,
  type EventLiveOverlayLayoutsResponse,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayout,
  type LiveOverlayPositions,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import { IconLayoutReset } from "../../../../../../../components/icons";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import { deleteJson, putJson } from "../../../../../../../shared/api-client";
import { toast } from "../../../../../ui";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Menu } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { OverlayLayoutCanvas } from "./OverlayLayoutCanvas";
import { OverlayLayoutGraphics, type LayoutSharingAction } from "./OverlayLayoutGraphics";
import { OverlayLayoutInspector } from "./OverlayLayoutInspector";
import { OverlayLayoutRenameDialog } from "./OverlayLayoutRenameDialog";
import {
  applyLayoutElementToAll,
  changeLayoutElement,
  layoutElementsChanged,
  layoutsSharing,
  relinkLayoutElement,
  unlinkLayoutElement,
  type LayoutDrafts,
} from "./overlay-layout-sharing";
import { LAYOUT_UNITS, type Box } from "./overlay-layout-editing";
import { reorderSceneGraphic, sceneGraphics } from "./overlay-layout-graphics";
import { readSafeAreasPreference, saveSafeAreasPreference } from "./overlay-layout-labels";

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const SHARING: Record<LayoutSharingAction, (drafts: LayoutDrafts, element: LiveOverlayElement) => LayoutDrafts> = {
  unlink: unlinkLayoutElement,
  relink: relinkLayoutElement,
  apply: applyLayoutElementToAll,
};

/**
 * One scene's editor: the canvas with the selected graphic's exact position
 * under it, beside the scene's graphics. A graphic linked to the event's
 * shared position moves on every scene that shares it; its row menu places
 * it for this scene only, or shares it again. Changes stay a draft until
 * saved; the scene's menu renames or duplicates it, resets a built-in scene
 * to its default, and deletes one of the event's own. Without `canEdit` the
 * scene is only drawn: nothing in it can be changed or saved.
 */
export function OverlayLayoutEditor({
  endpoint,
  positionsEndpoint,
  layout,
  layouts,
  positions: savedPositions,
  canEdit,
  onSaved,
  onDuplicate,
  onDirty,
}: {
  endpoint: string;
  /** The event's shared positions resource. */
  positionsEndpoint: string;
  layout: LiveOverlayLayout;
  /** Every scene, to say how many share a graphic's position. */
  layouts: readonly LiveOverlayLayout[];
  positions: LiveOverlayPositions;
  /** Whether the viewer may change the event's scenes. */
  canEdit: boolean;
  onSaved: (layouts: EventLiveOverlayLayoutsResponse, select?: string) => void;
  onDuplicate: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(layout.name);
  const initial = (): LayoutDrafts => ({ elements: layout.elements, positions: savedPositions.elements });
  const [drafts, setDrafts] = useState<LayoutDrafts>(initial);
  const { elements } = drafts;
  const graphics = sceneGraphics(elements);
  const [picked, setPicked] = useState<LiveOverlayElement | null>(null);
  // The graphic picked, while the scene still shows it; else the one in front.
  const selected = picked && graphics.some((element) => element === picked) ? picked : (graphics[0] ?? null);
  const [unit, setUnit] = useHashQueryParam("units", "percent", LAYOUT_UNITS);
  const [exact, setExact] = useState(false);
  const [safeAreas, setSafeAreas] = useState(readSafeAreasPreference);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A save hands back the stored scene; the draft starts again from it.
  const latestLayout = useRef({ layout, savedPositions });
  latestLayout.current = { layout, savedPositions };
  useEffect(() => {
    const current = latestLayout.current;
    setName(current.layout.name);
    setDrafts({ elements: current.layout.elements, positions: current.savedPositions.elements });
  }, [layout.slug, layout.updatedAt, savedPositions.updatedAt]);
  const scene = { expectedUpdatedAt: layout.updatedAt, name, preset: layout.preset, elements };
  const form = useContractForm(eventLiveOverlayLayoutPutSchema, scene, {
    // A refused box opens the exact position of its graphic, so the field that says why is in view.
    revealField: (path) => {
      const element = /^elements\.([^.]+)\./.exec(path)?.[1] as LiveOverlayElement | undefined;
      if (!element) return;
      setPicked(element);
      setExact(true);
    },
  });
  const positionsChanged = (next: LayoutDrafts) => !same(next.positions, savedPositions.elements);
  const layoutChanged = (next: LayoutDrafts, nextName = name) =>
    nextName !== layout.name || layoutElementsChanged(next.elements, layout.elements);
  const dirty = layoutChanged(drafts) || positionsChanged(drafts);
  const preset = layout.preset ? LIVE_OVERLAY_PRESET_LAYOUTS[layout.preset] : null;
  const presetElements = preset ? resolveLiveOverlayElements(preset.elements, drafts.positions) : null;
  const update = (next: LayoutDrafts) => {
    setDrafts(next);
    setProblem(null);
    onDirty(layoutChanged(next) || positionsChanged(next));
  };
  const change = (element: LiveOverlayElement, patch: Partial<LiveOverlayElementPlacement>) =>
    update(changeLayoutElement(drafts, element, patch));
  const place = (element: LiveOverlayElement, box: Box) => change(element, box);
  const share = (element: LiveOverlayElement, action: LayoutSharingAction) => update(SHARING[action](drafts, element));
  // An added graphic starts at its shared position, where the event's other scenes put it.
  const show = (element: LiveOverlayElement, visible: boolean) => {
    if (!visible) {
      change(element, { visible });
      return;
    }
    update(changeLayoutElement(relinkLayoutElement(drafts, element), element, { visible }));
    setPicked(element);
  };

  async function save(event?: SubmitEvent) {
    event?.preventDefault();
    if (busy || !canEdit) return;
    const checked = form.submit();
    if (!checked.data) {
      setProblem(checked.formMessage);
      return;
    }
    setBusy(true);
    try {
      // The shared positions first: the scene's shared graphics take them, so a failed scene save loses nothing.
      let saved: EventLiveOverlayLayoutsResponse | null = null;
      if (positionsChanged(drafts))
        saved = await putJson(
          positionsEndpoint,
          eventLiveOverlayPositionsPutSchema.parse({
            expectedUpdatedAt: savedPositions.updatedAt,
            elements: drafts.positions,
          }),
          eventLiveOverlayLayoutsResponseSchema,
        );
      if (layoutChanged(drafts))
        saved = await putJson(
          `${endpoint}/${encodeURIComponent(layout.slug)}`,
          checked.data,
          eventLiveOverlayLayoutsResponseSchema,
        );
      form.reset();
      if (saved) onSaved(saved);
      onDirty(false);
      toast("Scene saved. Browser sources using it update within 30 seconds.", "success");
    } catch (cause) {
      setProblem(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    const confirmed = await confirmAction({
      title: `Delete ${name}?`,
      body: `Browser sources that use this scene switch to ${LIVE_OVERLAY_PRESET_LAYOUTS[LIVE_OVERLAY_DEFAULT_LAYOUT].name}. This cannot be undone.`,
      confirmLabel: "Delete scene",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      onDirty(false);
      onSaved(
        await deleteJson(`${endpoint}/${encodeURIComponent(layout.slug)}`, eventLiveOverlayLayoutsResponseSchema),
        LIVE_OVERLAY_DEFAULT_LAYOUT,
      );
    } catch (cause) {
      setProblem(form.refuse(cause));
      setBusy(false);
    }
  }
  // A built-in scene goes back to its default name and graphics, saved at once; the shared positions stay.
  async function resetScene() {
    if (!preset || !presetElements) return;
    const confirmed = await confirmAction({
      title: `Reset ${name}?`,
      body: `It goes back to the built-in ${preset.name} scene: its name, its graphics and their order. Browser sources using it update within 30 seconds.`,
      confirmLabel: "Reset scene",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const saved = await putJson(
        `${endpoint}/${encodeURIComponent(layout.slug)}`,
        eventLiveOverlayLayoutPutSchema.parse({
          expectedUpdatedAt: layout.updatedAt,
          name: preset.name,
          preset: layout.preset,
          elements: presetElements,
        }),
        eventLiveOverlayLayoutsResponseSchema,
      );
      form.reset();
      onDirty(false);
      onSaved(saved);
      toast(`${preset.name} is back to its default.`, "success");
    } catch (cause) {
      setProblem(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  async function resetPositions() {
    const confirmed = await confirmAction({
      title: "Reset shared positions?",
      body: "Every scene that shares a graphic's position moves it back to its standard place.",
      confirmLabel: "Reset positions",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      onDirty(false);
      onSaved(await deleteJson(positionsEndpoint, eventLiveOverlayLayoutsResponseSchema));
    } catch (cause) {
      setProblem(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  function discard() {
    setName(layout.name);
    setDrafts(initial());
    form.reset();
    setProblem(null);
    onDirty(false);
  }

  if (!canEdit)
    return (
      <div class="pk-scenes__editor" data-read-only="">
        <Panel>
          <PanelHeader title={name} headingLevel={4} />
          <PanelBody class="pk-stack">
            <OverlayLayoutCanvas
              elements={elements}
              shown={graphics}
              selected={null}
              canEdit={false}
              safeAreas={safeAreas}
              onSafeAreas={(shown) => {
                setSafeAreas(shown);
                saveSafeAreasPreference(shown);
              }}
              onSelect={setPicked}
              onChange={place}
            />
          </PanelBody>
        </Panel>
      </div>
    );
  return (
    <>
      <form noValidate class="pk-scenes__editor" {...form.handlers} onSubmit={(event) => void save(event)}>
        <Panel>
          <PanelHeader
            title={name}
            headingLevel={4}
            menu={
              <Menu
                label={`Actions for ${layout.name}`}
                align="end"
                items={[
                  { id: "rename", label: "Rename", disabled: busy, onSelect: () => setRenaming(true) },
                  { id: "duplicate", label: "Duplicate", onSelect: onDuplicate },
                  ...(preset && layout.builtIn
                    ? [
                        {
                          id: "reset",
                          label: "Reset scene",
                          icon: <IconLayoutReset />,
                          description: `Back to the built-in ${preset.name}`,
                          disabled:
                            busy ||
                            (!dirty && name === preset.name && !layoutElementsChanged(elements, presetElements!)),
                          onSelect: () => void resetScene(),
                        },
                      ]
                    : []),
                  {
                    id: "reset-positions",
                    label: "Reset shared positions",
                    disabled: !savedPositions.saved,
                    onSelect: () => void resetPositions(),
                  },
                  ...(layout.builtIn
                    ? []
                    : [
                        {
                          id: "delete",
                          label: "Delete scene",
                          danger: true,
                          separatorBefore: true,
                          onSelect: () => void remove(),
                        },
                      ]),
                ]}
              />
            }
          >
            {dirty ? (
              <Button variant="ghost" disabled={busy} onClick={discard}>
                Discard changes
              </Button>
            ) : null}
            <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
              Save scene
            </Button>
          </PanelHeader>
          <PanelBody class="pk-stack">
            {problem ? <Alert tone="danger">{problem}</Alert> : null}
            <OverlayLayoutCanvas
              elements={elements}
              shown={graphics}
              selected={selected}
              safeAreas={safeAreas}
              onSafeAreas={(shown) => {
                setSafeAreas(shown);
                saveSafeAreasPreference(shown);
              }}
              onSelect={setPicked}
              onChange={place}
            />
            {selected ? (
              <OverlayLayoutInspector
                element={selected}
                placement={elements[selected]}
                unit={unit}
                disabled={busy}
                form={form}
                sharing={layoutsSharing(layouts, selected)}
                open={exact}
                onOpen={setExact}
                onUnit={setUnit}
                onChange={change}
              />
            ) : null}
          </PanelBody>
        </Panel>
        <OverlayLayoutGraphics
          elements={elements}
          selected={selected}
          disabled={busy}
          onSelect={setPicked}
          onShow={show}
          onReorder={(element, to) => update({ ...drafts, elements: reorderSceneGraphic(elements, element, to) })}
          onSharing={share}
        />
      </form>
      {renaming ? (
        <OverlayLayoutRenameDialog
          scene={scene}
          slug={layout.slug}
          onCancel={() => setRenaming(false)}
          onRename={(next) => {
            setRenaming(false);
            setName(next);
            setProblem(null);
            onDirty(layoutChanged(drafts, next) || positionsChanged(drafts));
          }}
        />
      ) : null}
    </>
  );
}
