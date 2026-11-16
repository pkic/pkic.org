/** The organizer's view of unfinished registrations: how many stopped, and what they said. */
import { formatDate } from "../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../shared/format-number";
import {
  unfinishedRegistrationNoteListSchema,
  unfinishedRegistrationSummarySchema,
  type UnfinishedRegistrationSummary,
} from "../../../../../../shared/schemas/unfinished-registrations";
import {
  UNFINISHED_REGISTRATION_REASON_LABELS,
  type UnfinishedRegistrationReason,
} from "../../../../../../shared/unfinished-registrations";
import { ApiDataTable } from "../../../../../components/ApiDataTable";
import { useData } from "../../../../../hooks/useData";
import type { CollectionLoader } from "../../../../../hooks/useServerCollection";
import { getJson } from "../../../../../shared/api-client";
import { Alert } from "../../../../../ui/Alert";
import { DataTable } from "../../../../../ui/DataTable";
import { EmptyState } from "../../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { Spinner } from "../../../../../ui/Spinner";
import { StatCard } from "../../../../../ui/StatCard";

const reasonLabel = (reason: UnfinishedRegistrationReason | null) =>
  reason ? UNFINISHED_REGISTRATION_REASON_LABELS[reason] : "No reason given";

export function UnfinishedRegistrations({ slug }: { slug: string }) {
  const { data, loading, error } = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/registrations/unfinished/summary`,
        unfinishedRegistrationSummarySchema,
      ),
    [slug],
  );
  if (loading) return <Spinner label="Loading unfinished registrations…" />;
  if (!data) return <Alert tone="danger">{error}</Alert>;
  return (
    <UnfinishedRegistrationsSummary
      summary={data}
      notesEndpoint={`/api/v1/events/${encodeURIComponent(slug)}/registrations/unfinished/notes`}
    />
  );
}

export function UnfinishedRegistrationsSummary({
  summary,
  notesEndpoint,
  loadNotes,
}: {
  summary: UnfinishedRegistrationSummary;
  notesEndpoint: string;
  /** Replaces the request for the notes, where there is no server to ask. */
  loadNotes?: CollectionLoader;
}) {
  if (summary.started === 0)
    return (
      <EmptyState
        title="Nobody has started registering yet"
        body="People who start the registration form while signed in are counted here."
      />
    );
  return (
    <div class="pk-stack">
      <div class="pk-stat-row">
        <StatCard label="Started registering" value={formatNumber(summary.started)} />
        <StatCard
          label="Registered"
          value={formatNumber(summary.registered)}
          note={`${formatNumber(Math.round((summary.registered / summary.started) * 100))}% of those who started`}
        />
        <StatCard label="Reminded" value={formatNumber(summary.reminded)} />
        <StatCard
          label="Not registering"
          value={formatNumber(summary.stopped)}
          note={summary.stopped > 0 ? `${formatNumber(summary.gaveReason)} gave a reason` : undefined}
        />
      </div>
      {summary.reasons.length > 0 && (
        <Panel aria-label="Why people did not register">
          <PanelHeader title="Why people did not register" />
          <PanelBody flush>
            <DataTable
              caption="Reasons"
              rows={summary.reasons}
              rowKey={(row) => row.reasonCode ?? "none"}
              columns={[
                { id: "reason", header: "Reason", cell: (row) => reasonLabel(row.reasonCode) },
                {
                  id: "people",
                  header: "People",
                  width: "fit",
                  align: "end",
                  cell: (row) => formatNumber(row.count),
                },
              ]}
            />
          </PanelBody>
        </Panel>
      )}
      {summary.wroteNote > 0 && (
        <Panel aria-label="What people wrote">
          <PanelHeader title="What people wrote" />
          <ApiDataTable
            urlState="not-registering-notes"
            endpoint={notesEndpoint}
            responseSchema={unfinishedRegistrationNoteListSchema}
            resolve={(value) => value.notes}
            resolvePage={(value) => value.page}
            load={loadNotes}
            caption="Notes"
            paginate
            searchPlaceholder="Search notes…"
            initialSort="-stoppedAt"
            rowKey={(row) => `${row.stoppedAt}:${row.note}`}
            empty="No notes match."
            columns={[
              { header: "Note", cell: (row) => row.note, hideable: false },
              { header: "Reason", cell: (row) => reasonLabel(row.reasonCode) },
              {
                header: "Date",
                cell: (row) => formatDate(row.stoppedAt),
                sort: { asc: "stoppedAt", desc: "-stoppedAt" },
              },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
