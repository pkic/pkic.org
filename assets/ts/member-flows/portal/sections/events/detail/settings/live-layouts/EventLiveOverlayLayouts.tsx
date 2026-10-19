import { useEffect, useState } from "preact/hooks";
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
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { EventLiveOverlaySources } from "./EventLiveOverlaySources";
import { OverlayLayoutCreateDialog } from "./OverlayLayoutCreateDialog";
import { OverlayLayoutEditor } from "./OverlayLayoutEditor";
import "./OverlayLayouts.css";

/** What a layout is in the list, in a few plain words. */
function describe(layout: LiveOverlayLayout): string {
  if (layout.slug === LIVE_OVERLAY_DEFAULT_LAYOUT) return layout.saved ? "Default, changed" : "Default";
  if (layout.builtIn) return layout.saved ? "Built-in, changed" : "Built-in";
  return "Custom";
}

/**
 * The event's broadcast overlay layouts: the list, the selected layout's
 * editor, and its browser sources. The selected layout follows the
 * address, so a bookmark opens the same one.
 */
export function EventLiveOverlayLayouts({ slug }: { slug: string }) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/settings/live/layouts`;
  const loaded = useData(() => getJson(endpoint, eventLiveOverlayLayoutsResponseSchema), [slug]);
  const [saved, setSaved] = useState<EventLiveOverlayLayoutsResponse | null>(null);
  const layouts = saved?.layouts ?? null;
  const [chosen, choose] = useHashQueryParam("layout", LIVE_OVERLAY_DEFAULT_LAYOUT);
  const [creating, setCreating] = useState<{ from: LiveOverlayLayout; duplicate: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
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
  if (!saved || !layouts) return <Spinner label="Loading layouts…" />;
  const current = layouts.find((layout) => layout.slug === chosen) ?? layouts[0]!;
  async function open(next: string) {
    if (next === current.slug) return;
    if (
      dirty &&
      !(await confirmAction({
        title: `Discard changes to ${current.name}?`,
        body: "Your changes to this layout are not saved.",
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
      <Panel>
        <PanelHeader title="Overlay layouts">
          <Button onClick={() => setCreating({ from: current, duplicate: false })}>New layout</Button>
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p class="pk-muted">
            A layout decides which graphics a browser source shows and where. In your production software, add the same
            output once per scene, each with its own layout.
          </p>
          <div class="pk-layout-shell">
            <div class="pk-layout-workspace">
              <nav class="pk-layout-list" aria-label="Layouts">
                <ul>
                  {layouts.map((layout) => (
                    <li key={layout.slug}>
                      <button
                        type="button"
                        class="pk-layout-list__item"
                        aria-current={layout.slug === current.slug ? "true" : undefined}
                        onClick={() => void open(layout.slug)}
                      >
                        <span class="pk-layout-list__name">{layout.name}</span>
                        <span class="pk-layout-list__kind">{describe(layout)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <OverlayLayoutEditor
                key={current.slug}
                endpoint={endpoint}
                positionsEndpoint={`/api/v1/events/${encodeURIComponent(slug)}/settings/live/positions`}
                layout={current}
                layouts={layouts}
                positions={saved.positions}
                onDirty={setDirty}
                onDuplicate={() => setCreating({ from: current, duplicate: true })}
                onSaved={(next, select) => {
                  setSaved(next);
                  if (select) choose(select);
                }}
              />
            </div>
          </div>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title={`Browser sources for ${current.name}`} />
        <PanelBody>
          <EventLiveOverlaySources slug={slug} layout={current} />
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
