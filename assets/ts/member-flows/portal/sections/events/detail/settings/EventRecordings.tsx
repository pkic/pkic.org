import type { z } from "zod";
import { RecordingSourceEditor } from "./RecordingSourceEditor";
import { RecordingSourceDetails } from "./RecordingSourceDetails";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { usePortalHashLocation } from "../../../../hash-location";
import { eventRecordingSourceSchema } from "../../../../../../../shared/schemas/event-recordings";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../ui/Spinner";
import { useState } from "preact/hooks";
import {
  eventRecordingSourcesResponseSchema,
  eventRecordingVersionsResponseSchema,
  type EventRecordingSource,
  type EventRecordingVersion,
} from "../../../../../../../shared/schemas/event-recordings";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { TabList } from "../../../../../../ui/TabList";
import { RowActions } from "../../../../../../ui/RowActions";

function RecordingCollections({
  slug,
  onCreate,
  onSelect,
}: {
  slug: string;
  onCreate: () => void;
  onSelect: (source: EventRecordingSource) => void;
}) {
  const [tab, setTab] = useState("sources");
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/recordings`;
  return (
    <section aria-label="Event recordings">
      <TabList
        label="Recording collections"
        items={[
          { id: "sources", label: "Recordings" },
          { id: "versions", label: "Acquired files" },
        ]}
        activeId={tab}
        onSelect={setTab}
      />
      {tab === "sources" ? (
        <ApiDataTable<EventRecordingSource, z.infer<typeof eventRecordingSourcesResponseSchema>>
          endpoint={`${endpoint}/sources`}
          responseSchema={eventRecordingSourcesResponseSchema}
          resolve={(response) => response.sources}
          resolvePage={(response) => response.page}
          paginate
          initialSort="-invokedAt"
          caption="Recordings"
          empty="No recordings have been selected for this event."
          rowKey={(row) => row.id}
          createAction={{ label: "Add recording", onSelect: onCreate }}
          rowAction={(row) => ({ label: "View recording", onSelect: () => onSelect(row) })}
          columns={[
            {
              header: "Recorded",
              sort: { asc: "startedAt", desc: "-startedAt" },
              cell: (row) => formatDateTime(row.startedAt),
            },
            {
              header: "Status",
              cell: (row) => row.status.toLowerCase().replace(/^./u, (letter) => letter.toUpperCase()),
            },
            { header: "Bytes", align: "end", width: "fit", cell: (row) => formatNumber(row.fileBytes) },
            {
              header: "Actions",
              cell: (row) => (
                <RowActions
                  subject={`recording ${formatDateTime(row.startedAt)}`}
                  actions={[{ id: "view", label: "View recording", onSelect: () => onSelect(row) }]}
                />
              ),
            },
          ]}
        />
      ) : (
        <ApiDataTable<EventRecordingVersion, z.infer<typeof eventRecordingVersionsResponseSchema>>
          endpoint={`${endpoint}/versions`}
          responseSchema={eventRecordingVersionsResponseSchema}
          resolve={(response) => response.versions}
          resolvePage={(response) => response.page}
          paginate
          initialSort="-acquiredAt"
          caption="Acquired recording files"
          empty="No recording files have been acquired."
          rowKey={(row) => row.id}
          columns={[
            { header: "Version", align: "end", width: "fit", cell: (row) => formatNumber(row.version) },
            {
              header: "Acquired",
              sort: { asc: "acquiredAt", desc: "-acquiredAt" },
              cell: (row) => formatDateTime(row.acquiredAt),
            },
            { header: "File type", cell: (row) => row.mimeType },
            { header: "Bytes", align: "end", width: "fit", cell: (row) => formatNumber(row.fileBytes) },
          ]}
        />
      )}
    </section>
  );
}

export function EventRecordings({
  slug,
  basePath,
  sourceId,
  canLinkProviderMeetings = false,
}: {
  slug: string;
  basePath: string;
  sourceId?: string;
  canLinkProviderMeetings?: boolean;
}) {
  const [, navigate] = usePortalHashLocation();
  if (sourceId === "new")
    return (
      <RecordingSourceEditor
        slug={slug}
        canLinkProviderMeetings={canLinkProviderMeetings}
        onSaved={(source) => navigate(`${basePath}/${source.id}`)}
        onClose={() => navigate(basePath)}
      />
    );
  if (sourceId)
    return (
      <RecordingDetailsPage
        key={`${slug}:${sourceId}`}
        slug={slug}
        sourceId={sourceId}
        onClose={() => navigate(basePath)}
      />
    );
  return (
    <RecordingCollections
      slug={slug}
      onCreate={() => navigate(`${basePath}/new`)}
      onSelect={(source) => navigate(`${basePath}/${source.id}`)}
    />
  );
}
function RecordingDetailsPage({ slug, sourceId, onClose }: { slug: string; sourceId: string; onClose: () => void }) {
  const result = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/recordings/sources/${encodeURIComponent(sourceId)}`,
        eventRecordingSourceSchema,
      ),
    [slug, sourceId],
  );
  return result.error ? (
    <ErrorAlert error={result.error} />
  ) : result.data ? (
    <RecordingSourceDetails slug={slug} source={result.data} onClose={onClose} onRefresh={result.reload} />
  ) : (
    <Spinner />
  );
}
