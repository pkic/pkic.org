import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { useRouteView } from "../../../../../../hooks/useRouteView";
import { splitHash } from "../../../../../../ui/url-query";
import { TabList } from "../../../../../../ui/TabList";
import { AgendaPublicationWorkspace } from "./AgendaPublicationWorkspace";
import { AgendaPublicPreview } from "./AgendaPublicPreview";

/** Approval and public projection share a routed workspace, without implying unavailable revision history. */
export function AgendaRevisions({
  snapshot,
  canEdit,
  onSaved,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  onSaved: (snapshot: AgendaSnapshot) => void;
}) {
  const base = splitHash().path.replace(/\/agenda\/revisions(?:\/.*)?\/?$/, "/agenda/revisions");
  const [view, setView] = useRouteView(base, ["review", "preview"] as const, "review");
  return (
    <div class="pk-stack">
      <TabList
        label="Revisions"
        idPrefix="agenda-revisions"
        activeId={view}
        onSelect={(value) => {
          if (value === "review" || value === "preview") setView(value);
        }}
        items={[
          { id: "review", label: "Review", panelId: "agenda-revisions-panel-review" },
          { id: "preview", label: "Public preview", panelId: "agenda-revisions-panel-preview" },
        ]}
      />
      <div role="tabpanel" id={`agenda-revisions-panel-${view}`} aria-labelledby={`agenda-revisions-${view}`}>
        {view === "review" ? (
          <AgendaPublicationWorkspace
            snapshot={snapshot}
            canEdit={canEdit}
            onSaved={onSaved}
            onPreview={() => setView("preview")}
          />
        ) : (
          <AgendaPublicPreview slug={snapshot.eventSlug} />
        )}
      </div>
    </div>
  );
}
