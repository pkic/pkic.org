import { useEffect, useMemo, useState } from "preact/hooks";
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
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import { deleteJson, putJson } from "../../../../../../../shared/api-client";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Field } from "../../../../../../../ui/Field";
import { Menu } from "../../../../../../../ui/Menu";
import { TextInput } from "../../../../../../../ui/TextControl";
import { OverlayLayoutCanvas } from "./OverlayLayoutCanvas";
import {
  OverlayLayoutElementList,
  OverlayLayoutInspector,
  compositionOf,
  type LayoutSharingAction,
} from "./OverlayLayoutInspector";
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
import { sampleOverlayRoom } from "./overlay-layout-sample";

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const SHARING: Record<LayoutSharingAction, (drafts: LayoutDrafts, element: LiveOverlayElement) => LayoutDrafts> = {
  unlink: unlinkLayoutElement,
  relink: relinkLayoutElement,
  apply: applyLayoutElementToAll,
};

/**
 * One layout's editor: its name, the canvas, the element list and the
 * selected element's exact box. An element linked to the event's shared
 * position moves on every layout that shares it; the link menu beside it
 * places it for this layout only, or shares it again. Changes stay a draft
 * until saved; the layout's menu duplicates, resets or deletes it.
 */
export function OverlayLayoutEditor({
  endpoint,
  positionsEndpoint,
  layout,
  layouts,
  positions: savedPositions,
  onSaved,
  onDuplicate,
  onDirty,
}: {
  endpoint: string;
  /** The event's shared positions resource. */
  positionsEndpoint: string;
  layout: LiveOverlayLayout;
  /** Every layout, to say how many share an element's position. */
  layouts: readonly LiveOverlayLayout[];
  positions: LiveOverlayPositions;
  onSaved: (layouts: EventLiveOverlayLayoutsResponse, select?: string) => void;
  onDuplicate: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(layout.name);
  const initial = (): LayoutDrafts => ({ elements: layout.elements, positions: savedPositions.elements });
  const [drafts, setDrafts] = useState<LayoutDrafts>(initial);
  const { elements } = drafts;
  const [selected, setSelected] = useState<LiveOverlayElement>("lowerThird");
  const [unit, setUnit] = useHashQueryParam("units", "percent", LAYOUT_UNITS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const room = useMemo(() => sampleOverlayRoom(Date.now()), []);
  // A save hands back the stored layout; the draft starts again from it.
  useEffect(() => {
    setName(layout.name);
    setDrafts(initial());
  }, [layout.slug, layout.updatedAt, savedPositions.updatedAt]);
  const form = useContractForm(eventLiveOverlayLayoutPutSchema, {
    expectedUpdatedAt: layout.updatedAt,
    name,
    preset: layout.preset,
    elements,
  });
  const positionsChanged = (next: LayoutDrafts) => !same(next.positions, savedPositions.elements);
  const layoutChanged = (next: LayoutDrafts, nextName = name) =>
    nextName !== layout.name || layoutElementsChanged(next.elements, layout.elements);
  const dirty = layoutChanged(drafts) || positionsChanged(drafts);
  const preset = layout.preset ? LIVE_OVERLAY_PRESET_LAYOUTS[layout.preset] : null;
  const presetElements = preset ? resolveLiveOverlayElements(preset.elements, drafts.positions) : null;
  const update = (next: LayoutDrafts) => {
    setDrafts(next);
    setNotice(null);
    onDirty(layoutChanged(next) || positionsChanged(next));
  };
  const change = (element: LiveOverlayElement, patch: Partial<LiveOverlayElementPlacement>) =>
    update(changeLayoutElement(drafts, element, patch));
  const place = (element: LiveOverlayElement, box: Box) => change(element, box);
  const share = (element: LiveOverlayElement, action: LayoutSharingAction) => update(SHARING[action](drafts, element));

  async function save(event?: SubmitEvent) {
    event?.preventDefault();
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setNotice(checked.formMessage ? { tone: "danger", text: checked.formMessage } : null);
      return;
    }
    setBusy(true);
    try {
      // The shared positions first: the layout's shared elements take them, so a failed layout save loses nothing.
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
      setNotice({ tone: "ok", text: "Layout saved. Browser sources using it update within 30 seconds." });
    } catch (cause) {
      setNotice({ tone: "danger", text: form.refuse(cause) });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    const confirmed = await confirmAction({
      title: `Delete ${layout.name}?`,
      body: "Browser sources that use this layout switch to Full frame.",
      confirmLabel: "Delete layout",
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
      setNotice({ tone: "danger", text: form.refuse(cause) });
      setBusy(false);
    }
  }
  async function resetPositions() {
    const confirmed = await confirmAction({
      title: "Reset shared positions?",
      body: "Every layout that shares an element's position moves it back to where Full frame places it.",
      confirmLabel: "Reset positions",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      onDirty(false);
      onSaved(await deleteJson(positionsEndpoint, eventLiveOverlayLayoutsResponseSchema));
    } catch (cause) {
      setNotice({ tone: "danger", text: form.refuse(cause) });
    } finally {
      setBusy(false);
    }
  }
  function discard() {
    setName(layout.name);
    setDrafts(initial());
    form.reset();
    setNotice(null);
    onDirty(false);
  }

  return (
    <form noValidate class="pk-layout-editor" {...form.handlers} onSubmit={(event) => void save(event)}>
      <div class="pk-layout-editor__head">
        <Field label="Layout name" help={`Browser sources name it “${layout.slug}”.`} {...form.of("name")}>
          {(control) => (
            <TextInput
              {...control}
              name="name"
              value={name}
              maxLength={60}
              disabled={busy}
              onInput={(event) => {
                setName(event.currentTarget.value);
                onDirty(layoutChanged(drafts, event.currentTarget.value) || positionsChanged(drafts));
              }}
            />
          )}
        </Field>
        <div class="pk-cluster">
          <Button type="submit" loading={busy} disabled={!dirty}>
            Save layout
          </Button>
          {dirty ? (
            <Button variant="ghost" disabled={busy} onClick={discard}>
              Discard changes
            </Button>
          ) : null}
          <Menu
            label={`Actions for ${layout.name}`}
            items={[
              { id: "duplicate", label: "Duplicate", onSelect: onDuplicate },
              ...(preset
                ? [
                    {
                      id: "reset",
                      label: `Reset to ${preset.name}`,
                      disabled: !layoutElementsChanged(elements, presetElements!),
                      onSelect: () => update({ ...drafts, elements: presetElements! }),
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
                      label: "Delete",
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => void remove(),
                    },
                  ]),
            ]}
          />
        </div>
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <div class="pk-layout-editor__workspace">
        <div class="pk-layout-editor__main">
          <OverlayLayoutCanvas
            elements={elements}
            composition={compositionOf(selected)}
            room={room}
            selected={selected}
            onSelect={setSelected}
            onChange={place}
          />
          <OverlayLayoutInspector
            element={selected}
            placement={elements[selected]}
            unit={unit}
            disabled={busy}
            form={form}
            sharing={layoutsSharing(layouts, selected)}
            onUnit={setUnit}
            onChange={change}
          />
        </div>
        <OverlayLayoutElementList
          elements={elements}
          selected={selected}
          disabled={busy}
          onSelect={setSelected}
          onChange={change}
          onSharing={share}
        />
      </div>
    </form>
  );
}
