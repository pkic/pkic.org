import { useEffect, useId, useState } from "preact/hooks";
import {
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  eventLiveOverlayLayoutsResponseSchema,
  type EventLiveOverlayLayoutsResponse,
  type LiveOverlayLayout,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../../components/Spinner";
import { useData } from "../../../../../../../hooks/useData";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import { getJson } from "../../../../../../../shared/api-client";
import { Button } from "../../../../../../../ui/Button";
import { IconPlus } from "../../../../../../../components/icons";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { SectionHeading } from "../../../../../../../ui/SectionHeading";
import { EventLiveOverlaySources } from "./EventLiveOverlaySources";
import { OverlayLayoutCreateDialog } from "./OverlayLayoutCreateDialog";
import { OverlayLayoutEditor } from "./OverlayLayoutEditor";
import "./OverlayLayouts.css";

/**
 * The event's scenes in three columns: the list, the selected scene's
 * canvas, and its graphics; then the rooms' browser sources. The selected
 * scene follows the address, so a bookmark opens the same one. Without
 * `canEdit` the scenes are only shown: the list and the selected scene drawn.
 */
export function EventLiveOverlayLayouts({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/settings/live/layouts`;
  const loaded = useData(() => getJson(endpoint, eventLiveOverlayLayoutsResponseSchema), [slug]);
  const [saved, setSaved] = useState<EventLiveOverlayLayoutsResponse | null>(null);
  const layouts = saved?.layouts ?? null;
  const [chosen, choose] = useHashQueryParam("layout", LIVE_OVERLAY_DEFAULT_LAYOUT);
  const [creating, setCreating] = useState<{ from: LiveOverlayLayout; duplicate: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const heading = useId();
  useEffect(() => {
    if (loaded.data) setSaved(loaded.data);
  }, [loaded.data]);

  if (loaded.error)
    return (
      <div class="pk-stack">
        <ErrorAlert error={loaded.error} />
        <div class="pk-cluster">
          <Button onClick={() => void loaded.reload()}>Try again</Button>
        </div>
      </div>
    );
  if (!saved || !layouts) return <Spinner label="Loading scenes…" />;
  const current = layouts.find((layout) => layout.slug === chosen) ?? layouts[0]!;
  async function open(next: string) {
    if (next === current.slug) return;
    if (
      dirty &&
      !(await confirmAction({
        title: `Discard changes to ${current.name}?`,
        body: "Your changes to this scene are not saved.",
        confirmLabel: "Discard changes",
        tone: "danger",
      }))
    )
      return;
    setDirty(false);
    choose(next);
  }
  return (
    <div class="pk-stack">
      <section class="pk-scenes" aria-labelledby={heading}>
        <SectionHeading level={3} id={heading} class="pk-scenes__title">
          Scenes
        </SectionHeading>
        <div class="pk-scenes__columns">
          <Panel class="pk-scenes__list">
            <PanelHeader title="Scenes" headingLevel={4}>
              {canEdit ? (
                <Button onClick={() => setCreating({ from: current, duplicate: false })}>
                  <IconPlus />
                  New scene
                </Button>
              ) : null}
            </PanelHeader>
            <PanelBody flush>
              <nav aria-label="Scenes">
                <ul class="pk-scenes__rows">
                  {layouts.map((layout) => (
                    <li key={layout.slug} class="pk-scenes__row">
                      <button
                        type="button"
                        class="pk-scenes__pick"
                        aria-current={layout.slug === current.slug ? "true" : undefined}
                        onClick={() => void open(layout.slug)}
                      >
                        <span class="pk-scenes__name">{layout.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <p class="pk-scenes__note">Every room in this event uses these scenes.</p>
            </PanelBody>
          </Panel>
          <OverlayLayoutEditor
            key={current.slug}
            endpoint={endpoint}
            positionsEndpoint={`/api/v1/events/${encodeURIComponent(slug)}/settings/live/positions`}
            layout={current}
            layouts={layouts}
            positions={saved.positions}
            canEdit={canEdit}
            onDirty={setDirty}
            onDuplicate={() => setCreating({ from: current, duplicate: true })}
            onSaved={(next, select) => {
              setSaved(next);
              if (select) choose(select);
            }}
          />
        </div>
      </section>
      <Panel>
        <PanelHeader title="Browser sources" />
        <PanelBody>
          <EventLiveOverlaySources slug={slug} layouts={layouts} />
        </PanelBody>
      </Panel>
      {creating ? (
        <OverlayLayoutCreateDialog
          endpoint={endpoint}
          layouts={layouts}
          from={creating.from}
          duplicate={creating.duplicate}
          onCancel={() => setCreating(null)}
          onCreated={(next, created) => {
            setSaved(next);
            setCreating(null);
            setDirty(false);
            choose(created);
          }}
        />
      ) : null}
    </div>
  );
}
