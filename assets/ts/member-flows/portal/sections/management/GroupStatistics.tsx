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
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
import { Select, TextInput } from "../../../../ui/TextControl";
import { fmt } from "../../ui";

interface DateWindow {
  scope: GroupStatsQuery["scope"];
  from: string;
  to: string;
}

/**
 * A rejected window, attributed to the boundary that caused it.
 *
 * The shared schema reports its own path — `to` for a window that ends before
 * it starts — so the message can land on that control as a `Field` state
 * rather than as a detached banner. That is what puts `aria-invalid` and
 * `aria-describedby` on the input the reader actually has to fix.
 */
interface WindowError {
  boundary: "from" | "to" | null;
  message: string;
}

const DEFAULT_WINDOW: DateWindow = { scope: "current", from: "", to: "" };

function toUtcBoundary(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
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

/** The message a boundary field shows, or undefined when the error is elsewhere. */
function messageFor(error: WindowError | null, boundary: "from" | "to"): string | undefined {
  return error?.boundary === boundary ? error.message : undefined;
}

export function GroupStatistics({ groupId }: { groupId: string }) {
  const [draft, setDraft] = useState<DateWindow>(DEFAULT_WINDOW);
  const [query, setQuery] = useState<GroupStatsQuery>(() =>
    groupStatsQuerySchema.parse({ scope: "current", timezone: "UTC" }),
  );
  const [queryError, setQueryError] = useState<WindowError | null>(null);
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
      const issue = parsed.error.issues[0];
      const path = issue?.path[0];
      setQueryError({
        boundary: path === "from" || path === "to" ? path : null,
        message: issue?.message ?? "Choose a valid UTC window.",
      });
      return;
    }
    setQueryError(null);
    setQuery(parsed.data);
  }

  if (!stats.data && stats.loading) return <Spinner label="Loading group statistics…" />;

  const fromMessage = messageFor(queryError, "from");
  const toMessage = messageFor(queryError, "to");
  const noActivity =
    stats.data?.activity.people.actionCount === 0 &&
    stats.data.activity.capacities.joinedCount === 0 &&
    stats.data.activity.capacities.leftCount === 0;

  return (
    <div class="pk pk-stack">
      {/* A panel is a section, so it is named rather than announced as an
          anonymous group of numbers. */}
      <Panel aria-label="Reporting window">
        <PanelHeader title="Reporting window" />
        <PanelBody class="pk-stack">
          <form class="pk-stack" aria-label="Statistics window" onSubmit={applyWindow}>
            <div class="pk-grid pk-grid--tight">
              <Field label="Count people who">
                {(control) => (
                  <Select
                    {...control}
                    value={draft.scope}
                    onChange={(event) => updateDraft("scope", event.currentTarget.value)}
                  >
                    <option value="current">Participate now</option>
                    <option value="historical">Participated during the window</option>
                  </Select>
                )}
              </Field>
              <Field
                label="From"
                help="A UTC day. Leave blank to start at the beginning of available history."
                state={fromMessage ? "invalid" : undefined}
                message={fromMessage}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    type="date"
                    value={draft.from}
                    onInput={(event) => updateDraft("from", event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                label="To"
                help="Up to, but not including, this UTC day. Leave blank to run up to now."
                state={toMessage ? "invalid" : undefined}
                message={toMessage}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    type="date"
                    value={draft.to}
                    onInput={(event) => updateDraft("to", event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>
            {/* A rejection the schema did not attribute to either boundary has
                no control to sit beside, so it is stated on its own. */}
            {queryError?.boundary === null && <Alert tone="danger">{queryError.message}</Alert>}
            <div class="pk-cluster">
              <Button type="submit" loading={stats.loading}>
                Apply window
              </Button>
            </div>
          </form>
          {stats.error && <ErrorAlert error={stats.error} />}
        </PanelBody>
      </Panel>

      {stats.data && (
        <>
          <Panel aria-label="Participation">
            <PanelHeader title="Participation" />
            <PanelBody class="pk-stack pk-stack--snug">
              <p class="pk-small">
                {stats.data.scope === "current"
                  ? "Active participation now."
                  : "Participation overlapping the selected window."}
              </p>
              <div class="pk-grid pk-grid--tight">
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
              <div class="pk-grid pk-grid--tight">
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
