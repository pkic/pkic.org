import { useState } from "preact/hooks";
import { agendaSnapshotSchema } from "../../../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Button } from "../../../../../../ui/Button";
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
        <PanelBody>
          <div class="pk-cluster" role="group" aria-label="Preview revision">
            <Button aria-pressed={revision === "draft"} onClick={() => setRevision("draft")}>
              Current draft
            </Button>
            <Button aria-pressed={revision === "approved"} onClick={() => setRevision("approved")}>
              Approved revision
            </Button>
          </div>
          <p class="pk-muted">Preview the public content and layout. This does not approve or publish changes.</p>
        </PanelBody>
      </Panel>
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
            <PanelBody>No public scheduled sessions in this revision.</PanelBody>
          </Panel>
        ))
      )}
    </div>
  );
}
