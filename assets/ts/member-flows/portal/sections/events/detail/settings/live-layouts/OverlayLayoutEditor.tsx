import { useState } from "preact/hooks";
import {
  LIVE_OVERLAY_PRESET_LAYOUTS,
  resolveLiveOverlayElements,
} from "../../../../../../../../shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  type EventLiveOverlayLayoutsResponse,
  type LiveOverlayLayout,
  type LiveOverlayPositions,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import { IconLayoutReset } from "../../../../../../../components/icons";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import { deleteJson, putJson } from "../../../../../../../shared/api-client";
import { toast } from "../../../../../ui";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Menu } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { OverlayLayoutCanvas } from "./OverlayLayoutCanvas";
import { OverlayLayoutGraphics, OverlayLayoutGraphicsSummary } from "./OverlayLayoutGraphics";
import { OverlayLayoutInspector } from "./OverlayLayoutInspector";
import { OverlayLayoutRenameDialog } from "./OverlayLayoutRenameDialog";
import { layoutElementsChanged, layoutsSharing } from "./overlay-layout-sharing";
import { LAYOUT_UNITS } from "./overlay-layout-editing";
import { readSafeAreasPreference, saveSafeAreasPreference } from "./overlay-layout-labels";
import { useSceneDraft } from "./useSceneDraft";

/**
 * One scene's editor: the canvas with the selected graphic's exact position
 * under it, beside the scene's graphics. A graphic linked to the event's
 * shared position moves on every scene that shares it; its row menu places
 * it for this scene only, or shares it again. A graphic that fills itself
 * from the room comes on with the scene or is switched in the studio, as its
 * row says. Changes stay a draft until saved; the scene's menu renames or
 * duplicates it, resets a built-in scene to its default, and deletes one of
 * the event's own. Without `canEdit` the scene is drawn and its graphics
 * listed: nothing in it can be changed or saved.
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
  const draft = useSceneDraft({
    endpoints: { layouts: endpoint, positions: positionsEndpoint },
    layout,
    positions: savedPositions,
    onSaved: (saved) => {
      onSaved(saved);
      toast("Scene saved. Every room shows the change.", "success");
    },
    onDirty,
  });
  const { name, elements, graphics, selected, form, busy, setBusy, problem, setProblem, dirty } = draft;
  const [unit, setUnit] = useHashQueryParam("units", "percent", LAYOUT_UNITS);
  const [safeAreas, setSafeAreas] = useState(readSafeAreasPreference);
  const [renaming, setRenaming] = useState(false);
  const preset = layout.preset ? LIVE_OVERLAY_PRESET_LAYOUTS[layout.preset] : null;
  const presetElements = preset ? resolveLiveOverlayElements(preset.elements, draft.drafts.positions) : null;

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
      body: `It goes back to the built-in ${preset.name} scene: its name, its graphics and their order. Every room shows it at once.`,
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
              onSelect={draft.select}
              onChange={draft.place}
            />
          </PanelBody>
        </Panel>
        <OverlayLayoutGraphicsSummary elements={elements} />
      </div>
    );
  return (
    <>
      <form
        noValidate
        class="pk-scenes__editor"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void draft.save();
        }}
      >
        <Panel>
          <PanelHeader
            title={name}
            headingLevel={4}
            menu={
              <Menu
                label={`Actions for ${layout.name}`}
                title={`Actions for ${layout.name}\nRename, duplicate or reset this scene.`}
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
                    tooltip: "Every scene that shares a graphic's position moves it back to its standard place.",
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
              <Button variant="ghost" disabled={busy} onClick={draft.discard}>
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
              onSelect={draft.select}
              onChange={draft.place}
            />
            {selected ? (
              <OverlayLayoutInspector
                element={selected}
                placement={elements[selected]}
                unit={unit}
                disabled={busy}
                form={form}
                sharing={layoutsSharing(layouts, selected)}
                open={draft.revealed}
                onOpen={draft.setRevealed}
                onUnit={setUnit}
                onChange={draft.change}
              />
            ) : null}
          </PanelBody>
        </Panel>
        <OverlayLayoutGraphics
          elements={elements}
          selected={selected}
          disabled={busy}
          onSelect={draft.select}
          onShow={draft.show}
          onComesOn={(element, comesOn) => draft.change(element, { comesOn })}
          onReorder={draft.reorder}
          onSharing={draft.share}
          onTurns={draft.spotTurns}
          onLock={draft.lock}
        />
      </form>
      {renaming ? (
        <OverlayLayoutRenameDialog
          scene={draft.scene}
          slug={layout.slug}
          onCancel={() => setRenaming(false)}
          onRename={(next) => {
            setRenaming(false);
            draft.rename(next);
          }}
        />
      ) : null}
    </>
  );
}
