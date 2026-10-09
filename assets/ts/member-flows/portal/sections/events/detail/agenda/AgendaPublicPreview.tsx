import { useState } from "preact/hooks";
import { agendaSnapshotSchema } from "../../../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Button } from "../../../../../../ui/Button";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { TabList } from "../../../../../../ui/TabList";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { agendaContent } from "../../../../../../../shared/public-agenda-content";

export function AgendaPublicPreview({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [revision, setRevision] = useState<"draft" | "approved">("draft");
  const source = useData(
    () =>
      getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda/previews?revision=${revision}`, agendaSnapshotSchema),
    [slug, revision],
  );
  const content = source.data ? agendaContent(source.data) : undefined;
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title="Public agenda preview">
          <Button onClick={onClose}>Back to agenda</Button>
        </PanelHeader>
        <TabList
          label="Preview revision"
          idPrefix="agenda-preview-revision"
          activeId={revision}
          onSelect={(id) => setRevision(id === "approved" ? "approved" : "draft")}
          items={[
            { id: "draft", label: "Current draft", panelId: "agenda-preview-panel" },
            { id: "approved", label: "Approved revision", panelId: "agenda-preview-panel" },
          ]}
        />
        <PanelBody>
          <p class="pk-muted">Preview the public content and layout. This does not approve or publish changes.</p>
        </PanelBody>
      </Panel>
      <div
        id="agenda-preview-panel"
        role="tabpanel"
        aria-labelledby={`agenda-preview-revision-${revision}`}
        class="pk-stack"
      >
        {source.loading ? (
          <Spinner label="Loading public preview…" />
        ) : source.error ? (
          <ErrorAlert error={source.error} />
        ) : (
          source.data &&
          content &&
          (content.days.length ? (
            <ContentAgenda
              days={content.days}
              speakers={content.speakers}
              timeZone={source.data.timeZone}
              legacySpeakerFragments={content.legacySpeakerFragments}
            />
          ) : (
            <Panel>
              <PanelBody>
                <EmptyState
                  title="No public scheduled sessions in this revision"
                  body="Sessions appear here once they have a day, a time and public visibility."
                />
              </PanelBody>
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
