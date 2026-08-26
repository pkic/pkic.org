import { useState } from "preact/hooks";
import {
  groupStatsQuerySchema,
  groupStatsResponseSchema,
  type GroupStatsQuery,
} from "../../../../../shared/schemas/group-statistics";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";

interface DateWindow {
  scope: GroupStatsQuery["scope"];
  from: string;
  to: string;
}

const DEFAULT_WINDOW: DateWindow = { scope: "current", from: "", to: "" };

function toUtcBoundary(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

function formatWindowBoundary(value: string | null): string {
  return value ? value.replace("T", " ").replace(".000Z", " UTC") : "Beginning of available history";
}

function queryString(query: GroupStatsQuery): string {
  const params = new URLSearchParams({ scope: query.scope, timezone: "UTC" });
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return params.toString();
}

function StatValue({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div class="col-sm-6 col-xl-3">
      <div class="border rounded p-3 h-100">
        <div class="small text-body-secondary">{label}</div>
        <div class="fs-3 fw-semibold" aria-label={`${label}: ${value}`}>
          {value}
        </div>
        <div class="small text-body-secondary">{help}</div>
      </div>
    </div>
  );
}

export function GroupStatistics({ groupId }: { groupId: string }) {
  const [draft, setDraft] = useState<DateWindow>(DEFAULT_WINDOW);
  const [query, setQuery] = useState<GroupStatsQuery>(() =>
    groupStatsQuerySchema.parse({ scope: "current", timezone: "UTC" }),
  );
  const [queryError, setQueryError] = useState<string | null>(null);
  const stats = useData(
    () =>
      getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/stats?${queryString(query)}`, groupStatsResponseSchema),
    [groupId, query.scope, query.from, query.to],
  );

  function updateDraft(field: keyof DateWindow, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function applyWindow(event: Event): void {
    event.preventDefault();
    const parsed = groupStatsQuerySchema.safeParse({
      scope: draft.scope,
      timezone: "UTC",
      from: toUtcBoundary(draft.from),
      to: toUtcBoundary(draft.to),
    });
    if (!parsed.success) {
      setQueryError(parsed.error.issues[0]?.message ?? "Choose a valid UTC window.");
      return;
    }
    setQueryError(null);
    setQuery(parsed.data);
  }

  if (!stats.data && stats.loading) return <Spinner />;

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Group statistics</div>
      <div class="card-body d-flex flex-column gap-4">
        <p class="text-muted small mb-0">
          Counts are calculated by the server in D1. People are distinct users; capacities are the Member participation
          rows they represent. Activity is limited to the UTC window below.
        </p>
        <form class="row g-3 align-items-end" onSubmit={applyWindow}>
          <div class="col-md-3">
            <label class="form-label" for="group-stats-scope">
              Population scope
            </label>
            <select
              id="group-stats-scope"
              class="form-select"
              value={draft.scope}
              onChange={(event) => updateDraft("scope", (event.target as HTMLSelectElement).value)}
            >
              <option value="current">Current participation</option>
              <option value="historical">Historical window</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label" for="group-stats-from">
              From (UTC)
            </label>
            <input
              id="group-stats-from"
              type="date"
              class="form-control"
              value={draft.from}
              onInput={(event) => updateDraft("from", (event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="col-md-3">
            <label class="form-label" for="group-stats-to">
              To (UTC, exclusive)
            </label>
            <input
              id="group-stats-to"
              type="date"
              class="form-control"
              value={draft.to}
              onInput={(event) => updateDraft("to", (event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="col-md-3">
            <button type="submit" class="btn btn-outline-secondary w-100">
              Apply window
            </button>
          </div>
        </form>
        {queryError && <ErrorAlert error={queryError} />}
        {stats.error && <ErrorAlert error={stats.error} />}
        {stats.data && (
          <>
            <div>
              <h6 class="mb-1">Participation</h6>
              <p class="small text-body-secondary mb-3">
                {stats.data.scope === "current"
                  ? "Active participation now."
                  : "Participation overlapping the selected window."}
              </p>
              <div class="row g-3">
                <StatValue label="People" value={stats.data.participation.people.count} help="Distinct users" />
                <StatValue
                  label="Membership capacities"
                  value={stats.data.participation.capacities.count}
                  help="Member participation rows"
                />
              </div>
            </div>
            <div>
              <h6 class="mb-1">Activity</h6>
              <p class="small text-body-secondary mb-3">
                {formatWindowBoundary(stats.data.window.from)} to {formatWindowBoundary(stats.data.window.to)}
              </p>
              <div class="row g-3">
                <StatValue
                  label="Active people"
                  value={stats.data.activity.people.actorCount}
                  help="People with audited actions"
                />
                <StatValue
                  label="Actions"
                  value={stats.data.activity.people.actionCount}
                  help="Audited group actions"
                />
                <StatValue
                  label="Joined"
                  value={stats.data.activity.capacities.joinedCount}
                  help="Capacity rows joined"
                />
                <StatValue label="Left" value={stats.data.activity.capacities.leftCount} help="Capacity rows left" />
              </div>
              {stats.data.activity.people.actionCount === 0 &&
                stats.data.activity.capacities.joinedCount === 0 &&
                stats.data.activity.capacities.leftCount === 0 && (
                  <p class="text-muted small mt-3 mb-0">No activity recorded in this UTC window.</p>
                )}
            </div>
            <p class="small text-body-secondary mb-0">Generated at {stats.data.generatedAt}.</p>
          </>
        )}
      </div>
    </div>
  );
}
