import { useState } from "preact/hooks";
import {
  GROUP_STATS_SCOPES,
  groupStatsQuerySchema,
  groupStatsResponseSchema,
  type GroupStatsQuery,
} from "../../../../../shared/schemas/group-statistics";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
import { Select, TextInput } from "../../../../ui/TextControl";
import { fmt } from "../../ui";
import "./GroupStatistics.css";

interface DateWindow {
  scope: GroupStatsQuery["scope"];
  from: string;
  to: string;
}

const DEFAULT_WINDOW: DateWindow = { scope: "current", from: "", to: "" };

/** Each scope is described by what it counts, not by the word the contract uses for it. */
const SCOPE_LABELS: Record<GroupStatsQuery["scope"], string> = {
  current: "Participate now",
  historical: "Participated during the window",
};

function toUtcBoundary(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

/**
 * The query the window draft would put on the wire, as the shared contract
 * reads it. The same contract decides what each boundary field shows — a
 * window that ends before it starts is reported on `to` — and what Apply may
 * send; nothing here second-guesses it.
 */
function windowQuery(draft: DateWindow) {
  return { scope: draft.scope, timezone: "UTC", from: toUtcBoundary(draft.from), to: toUtcBoundary(draft.to) };
}

function formatWindowBoundary(value: string | null): string {
  // Localized like every other instant; the boundary is defined in UTC but
  // read in the viewer's clock.
  return value ? fmt(value) : "Beginning of available history";
}

function queryString(query: GroupStatsQuery): string {
  const params = new URLSearchParams({ scope: query.scope, timezone: "UTC" });
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return params.toString();
}

export function GroupStatistics({ groupId }: { groupId: string }) {
  const [draft, setDraft] = useState<DateWindow>(DEFAULT_WINDOW);
  const [query, setQuery] = useState<GroupStatsQuery>(() =>
    groupStatsQuerySchema.parse({ scope: "current", timezone: "UTC" }),
  );
  const [windowError, setWindowError] = useState("");
  const [windowOpen, setWindowOpen] = useState(false);
  const form = useContractForm(groupStatsQuerySchema, windowQuery(draft));
  const stats = useData(
    () =>
      getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/stats?${queryString(query)}`, groupStatsResponseSchema),
    [groupId, query.scope, query.from, query.to],
  );

  function updateDraft(field: keyof DateWindow, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function applyWindow(): void {
    // A rejected window never reaches the server: the contract marks the
    // boundary it refuses and the form states the rest.
    const checked = form.submit();
    if (!checked.data) {
      setWindowError(checked.message);
      return;
    }
    setWindowError("");
    setQuery(checked.data);
    setWindowOpen(false);
  }

  function editWindow(): void {
    form.reset();
    setDraft({ scope: query.scope, from: query.from?.slice(0, 10) ?? "", to: query.to?.slice(0, 10) ?? "" });
    setWindowError("");
    setWindowOpen(true);
  }

  if (!stats.data && stats.loading) return <Spinner label="Loading group analytics…" />;

  const noActivity =
    stats.data?.activity.people.actionCount === 0 &&
    stats.data.activity.capacities.joinedCount === 0 &&
    stats.data.activity.capacities.leftCount === 0;

  return (
    <div class="pk pk-stack">
      {stats.error && <ErrorAlert error={stats.error} />}

      {stats.data && (
        <>
          <Panel aria-label="Participation">
            <PanelHeader title="Participation">
              <span class="pk-small pk-muted">
                {SCOPE_LABELS[query.scope]} · {query.from?.slice(0, 10) ?? "Beginning"}–
                {query.to?.slice(0, 10) ?? "now"}
              </span>
              <Menu
                label="Participation options"
                align="end"
                items={[{ id: "reporting-window", label: "Change reporting window", onSelect: editWindow }]}
              />
            </PanelHeader>
            {windowOpen && (
              <PanelBody class="pk-analytics-window-editor">
                <form
                  noValidate
                  class="pk-stack pk-stack--snug"
                  aria-label="Reporting window"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyWindow();
                  }}
                  {...form.handlers}
                >
                  <div class="pk-grid pk-grid--tight">
                    <Field label="Count people who" {...form.of("scope")}>
                      {(control) => (
                        <Select
                          {...control}
                          name="scope"
                          value={draft.scope}
                          onChange={(event) => updateDraft("scope", event.currentTarget.value)}
                        >
                          {GROUP_STATS_SCOPES.map((scope) => (
                            <option key={scope} value={scope}>
                              {SCOPE_LABELS[scope]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field
                      label="From"
                      help="A UTC day. Leave blank to start at the beginning of available history."
                      {...form.of("from")}
                    >
                      {(control) => (
                        <TextInput
                          {...control}
                          name="from"
                          type="date"
                          value={draft.from}
                          onInput={(event) => updateDraft("from", event.currentTarget.value)}
                        />
                      )}
                    </Field>
                    <Field
                      label="To"
                      help="Up to, but not including, this UTC day. Leave blank to run up to now."
                      {...form.of("to")}
                    >
                      {(control) => (
                        <TextInput
                          {...control}
                          name="to"
                          type="date"
                          value={draft.to}
                          onInput={(event) => updateDraft("to", event.currentTarget.value)}
                        />
                      )}
                    </Field>
                  </div>
                  {windowError && <Alert tone="danger">{windowError}</Alert>}
                  <div class="pk-cluster pk-cluster--end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        form.reset();
                        setWindowError("");
                        setWindowOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" variant="primary" type="submit">
                      Apply window
                    </Button>
                  </div>
                </form>
              </PanelBody>
            )}
            <PanelBody class="pk-stack pk-stack--snug">
              <p class="pk-small">
                {stats.data.scope === "current"
                  ? "Active participation now."
                  : "Participation overlapping the selected window."}
              </p>
              <div class="pk-stat-row">
                <StatCard label="People" value={String(stats.data.participation.people.count)} note="Distinct people" />
                <StatCard
                  label="Memberships"
                  value={String(stats.data.participation.capacities.count)}
                  note="One per Member represented"
                />
              </div>
            </PanelBody>
          </Panel>

          <Panel aria-label="Activity">
            <PanelHeader title="Activity" />
            <PanelBody class="pk-stack pk-stack--snug">
              <p class="pk-small">
                {formatWindowBoundary(stats.data.window.from)} to {formatWindowBoundary(stats.data.window.to)}
              </p>
              <div class="pk-stat-row">
                <StatCard
                  label="Active people"
                  value={String(stats.data.activity.people.actorCount)}
                  note="People with recorded actions"
                />
                <StatCard
                  label="Actions"
                  value={String(stats.data.activity.people.actionCount)}
                  note="Recorded in the audit log"
                />
                <StatCard
                  label="Joined"
                  value={String(stats.data.activity.capacities.joinedCount)}
                  note="Memberships started"
                />
                <StatCard
                  label="Left"
                  value={String(stats.data.activity.capacities.leftCount)}
                  note="Memberships ended"
                />
              </div>
              {noActivity && <EmptyState title="No activity recorded in this window." />}
            </PanelBody>
          </Panel>

          <p class="pk-small pk-muted">Generated {fmt(stats.data.generatedAt)}.</p>
        </>
      )}
    </div>
  );
}
