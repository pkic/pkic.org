import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { contractClock } from "../../../../../../../shared/event-clock";
import { agendaSnapshotSchema } from "../../../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { agendaContent } from "../../../../../../../shared/public-agenda-content";
import { agendaPreviewQuerySchema } from "../../../../../../../shared/schemas/route-contracts-event-agenda-preview";

const PREVIEW_REVISIONS = agendaPreviewQuerySchema.shape.revision.unwrap().options;
const PREVIEW_REVISION_LABELS: Record<(typeof PREVIEW_REVISIONS)[number], string> = {
  draft: "Current draft",
  approved: "Approved revision",
};

export function AgendaPublicPreview({ slug }: { slug: string }) {
  const [revision, setRevision] = useHashQueryParam("agendaRevision", "draft", PREVIEW_REVISIONS);
  const source = useData(
    () =>
      getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda/previews?revision=${revision}`, agendaSnapshotSchema),
    [slug, revision],
  );
  const content = source.data ? agendaContent(source.data) : undefined;
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title="Public agenda preview" />
        <PanelBody>
          <Field label="Preview revision">
            {(control) => (
              <Select
                {...control}
                value={revision}
                onChange={(event) => setRevision(event.currentTarget.value === "approved" ? "approved" : "draft")}
              >
                {PREVIEW_REVISIONS.map((value) => (
                  <option key={value} value={value}>
                    {PREVIEW_REVISION_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p class="pk-muted">Preview the public content and layout. This does not approve or publish changes.</p>
        </PanelBody>
      </Panel>
      <div id="agenda-preview-panel" class="pk-stack">
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
              timeZone={contractClock(source.data)}
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
