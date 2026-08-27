import {
  groupVoteStatisticsResponseSchema,
  type GroupVoteStatisticsResponse,
} from "../../../../../shared/schemas/group-vote-statistics";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";

type Aggregate = GroupVoteStatisticsResponse["aggregate"];

function labelize(value: string): string {
  return value.replaceAll("_", " ");
}

function formatValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}

function CountGrid({ counts }: { counts: Record<string, number> }) {
  return (
    <div class="row g-2">
      {Object.entries(counts).map(([key, value]) => (
        <div class="col-sm-4" key={key}>
          <div class="border rounded p-2 h-100">
            <div class="small text-body-secondary">{labelize(key)}</div>
            <div class="fs-5 fw-semibold">{value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AggregateSummary({ aggregate }: { aggregate: Aggregate }) {
  if (aggregate.availability === "withheld_until_closed") {
    return <p class="text-muted mb-0">Aggregate results will be available after the vote closes.</p>;
  }
  if (aggregate.availability === "unavailable") {
    return <p class="text-muted mb-0">Aggregate results are not available for this vote.</p>;
  }
  if (aggregate.availability !== "available") return null;
  if (aggregate.kind === "motion") {
    return (
      <div>
        <p class="small text-body-secondary mb-2">Motion ballot counts</p>
        <CountGrid counts={aggregate.counts} />
      </div>
    );
  }
  return (
    <div>
      <p class="small text-body-secondary mb-2">Election candidates</p>
      <div class="list-group">
        {aggregate.candidates.map((candidate, index) => {
          return (
            <div class="list-group-item d-flex justify-content-between" key={candidate.candidateId}>
              <span>{candidate.candidateName || `Candidate ${index + 1}`}</span>
              <span class="fw-semibold">{formatValue(candidate.count)}</span>
            </div>
          );
        })}
      </div>
    </div>
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

  if (!statistics.data && statistics.loading) return <Spinner />;
  if (statistics.error) return <ErrorAlert error={statistics.error} />;
  if (!statistics.data) return null;

  const { participation } = statistics.data;
  return (
    <section class="border rounded p-3 mt-3" aria-label="Vote statistics">
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h6 class="mb-1">Vote statistics</h6>
          <div class="small text-body-secondary">
            Round {statistics.data.round} · {labelize(statistics.data.status)} ·{" "}
            {labelize(statistics.data.electorateMode)}
          </div>
        </div>
        <span class="badge text-bg-secondary">Counts by {labelize(participation.unit)}</span>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-sm-6 col-xl-3">
          <div class="border rounded p-2 h-100">
            <div class="small text-body-secondary">Currently eligible</div>
            <div class="fs-5 fw-semibold">{participation.currentEligible}</div>
          </div>
        </div>
        <div class="col-sm-6 col-xl-3">
          <div class="border rounded p-2 h-100">
            <div class="small text-body-secondary">Currently eligible and cast</div>
            <div class="fs-5 fw-semibold">{participation.currentEligibleCast}</div>
          </div>
        </div>
        <div class="col-sm-6 col-xl-3">
          <div class="border rounded p-2 h-100">
            <div class="small text-body-secondary">Currently eligible and not cast</div>
            <div class="fs-5 fw-semibold">{participation.currentEligibleNotCast}</div>
          </div>
        </div>
        <div class="col-sm-6 col-xl-3">
          <div class="border rounded p-2 h-100">
            <div class="small text-body-secondary">Effective ballots</div>
            <div class="fs-5 fw-semibold">{participation.effectiveBallots}</div>
          </div>
        </div>
      </div>
      <p class="small text-body-secondary mb-3">
        Ballots without current eligibility: {participation.ballotsWithoutCurrentEligibility}
      </p>
      <AggregateSummary aggregate={statistics.data.aggregate} />
    </section>
  );
}
