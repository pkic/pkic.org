import {
  groupVoteStatisticsResponseSchema,
  type GroupVoteStatisticsResponse,
} from "../../../../../shared/schemas/group-vote-statistics";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Badge } from "../../../../ui/Badge";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";

type Aggregate = GroupVoteStatisticsResponse["aggregate"];

interface CandidateRow {
  candidateId: string;
  name: string;
  count: number;
}

const CANDIDATE_COLUMNS: ReadonlyArray<DataTableColumn<CandidateRow>> = [
  { id: "candidate", header: "Candidate", cell: (row) => row.name },
  { id: "count", header: "Ballots", align: "end", cell: (row) => row.count },
];

const candidateRowKey = (row: CandidateRow): string => row.candidateId;

function labelize(value: string): string {
  return value.replaceAll("_", " ");
}

/** The motion tally, one card per choice the server counted. */
function CountGrid({ counts }: { counts: Record<string, number> }) {
  return (
    <div class="pk-grid pk-grid--tight">
      {Object.entries(counts).map(([key, value]) => (
        <StatCard key={key} label={labelize(key)} value={String(value)} />
      ))}
    </div>
  );
}

function AggregateSummary({ aggregate }: { aggregate: Aggregate }) {
  if (aggregate.availability === "withheld_until_closed") {
    return <p class="pk-muted">Aggregate results will be available after the vote closes.</p>;
  }
  if (aggregate.availability === "unavailable") {
    return <p class="pk-muted">Aggregate results are not available for this vote.</p>;
  }
  if (aggregate.availability !== "available") return null;
  if (aggregate.kind === "motion") {
    return (
      <div class="pk-stack pk-stack--snug">
        <p class="pk-small pk-strong">Motion ballot counts</p>
        <CountGrid counts={aggregate.counts} />
      </div>
    );
  }
  if (aggregate.candidates.length === 0) {
    return <EmptyState title="Election candidates" body="No candidates were recorded for this round." />;
  }
  return (
    <DataTable
      caption="Election candidates"
      showCaption
      columns={CANDIDATE_COLUMNS}
      rows={aggregate.candidates.map((candidate, index) => ({
        candidateId: candidate.candidateId,
        name: candidate.candidateName || `Candidate ${String(index + 1)}`,
        count: candidate.count,
      }))}
      rowKey={candidateRowKey}
    />
  );
}

/** Manager-only, on-demand statistics for one selected group vote. */
export function GroupVoteStatistics({ groupId, voteId }: { groupId: string; voteId: string }) {
  const statistics = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(voteId)}/statistics`,
        groupVoteStatisticsResponseSchema,
      ),
    [groupId, voteId],
  );

  if (!statistics.data && statistics.loading) return <Spinner label="Loading vote statistics…" />;
  if (statistics.error) return <ErrorAlert error={statistics.error} />;
  if (!statistics.data) return null;

  const { participation } = statistics.data;
  return (
    <div class="pk">
      {/* A panel is a section, so it needs its own name to be announced as a
          region rather than an anonymous group of numbers. */}
      <Panel aria-label="Vote statistics">
        <PanelHeader title="Vote statistics">
          <Badge tone="neutral">Counts by {labelize(participation.unit)}</Badge>
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p class="pk-small">
            Round {statistics.data.round} · {labelize(statistics.data.status)} ·{" "}
            {labelize(statistics.data.electorateMode)}
          </p>
          <div class="pk-grid pk-grid--tight">
            <StatCard label="Currently eligible" value={String(participation.currentEligible)} />
            <StatCard label="Currently eligible and cast" value={String(participation.currentEligibleCast)} />
            <StatCard label="Currently eligible and not cast" value={String(participation.currentEligibleNotCast)} />
            <StatCard label="Effective ballots" value={String(participation.effectiveBallots)} />
          </div>
          <p class="pk-small">Ballots without current eligibility: {participation.ballotsWithoutCurrentEligibility}</p>
          <AggregateSummary aggregate={statistics.data.aggregate} />
        </PanelBody>
      </Panel>
    </div>
  );
}
