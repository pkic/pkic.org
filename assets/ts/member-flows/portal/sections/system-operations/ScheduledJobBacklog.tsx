import { useRef, useState } from "preact/hooks";
import {
  schedulerJobBacklogResponseSchema,
  schedulerJobBacklogRetryResponseSchema,
  type SchedulerJobBacklogItem,
} from "../../../../../shared/schemas/scheduler";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import type { Column } from "../../../../components/Table";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { getJson, postJson } from "../../../../shared/api-client";
import { Badge } from "../../../../ui/Badge";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { fmt, toast } from "../../ui";
import { scheduledJobTitle } from "./scheduled-job-title";
import "../../../../ui/Content.css";

const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

/** Expected states read as plain text; only work that needs a second look gets a tone. */
const NOTABLE_STATES: Record<string, "warn"> = { interrupted: "warn", retrying: "warn" };

/**
 * The work one scheduled job has not finished, as its own domain lists it, so
 * an operator can see what a run is still waiting for.
 */
export function ScheduledJobBacklog({ jobKey }: { jobKey: string }) {
  const title = scheduledJobTitle(jobKey);
  const tableActions = useRef<ApiTableActions | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  async function retryNow(item: SchedulerJobBacklogItem): Promise<void> {
    setBusyItem(item.id);
    try {
      const outcome = await postJson(
        `/api/v1/scheduler/jobs/${encodeURIComponent(jobKey)}/backlog/${encodeURIComponent(item.id)}/retries`,
        {},
        schedulerJobBacklogRetryResponseSchema,
      );
      await tableActions.current?.reload();
      if (outcome.finished) toast(`${item.typeLabel} for ${item.title} is done.`, "success");
      else toast(outcome.error ? `It failed again: ${outcome.error}` : "It failed again.", "error");
    } catch (retryError) {
      toast((retryError as Error).message, "error");
    } finally {
      setBusyItem(null);
    }
  }

  const columns: Column<SchedulerJobBacklogItem>[] = [
    {
      header: "Work",
      width: "primary",
      sort: { asc: "title", desc: "-title" },
      cell: (row) => (
        <div class="pk-stack pk-stack--tight">
          <strong>{row.title}</strong>
          {row.subtitle ? <span class="pk-small">{row.subtitle}</span> : null}
          <span class="pk-small pk-muted">{row.context}</span>
        </div>
      ),
    },
    { header: "Type", cell: (row) => row.typeLabel, width: "fit", sort: { asc: "typeLabel", desc: "-typeLabel" } },
    {
      header: "Status",
      cell: (row) => (
        <div class="pk-stack pk-stack--tight">
          <span>
            {NOTABLE_STATES[row.statusKey] ? (
              <Badge tone={NOTABLE_STATES[row.statusKey]}>{row.statusLabel}</Badge>
            ) : (
              row.statusLabel
            )}
          </span>
          {row.detail ? <span class="pk-small pk-muted pk-break">{row.detail}</span> : null}
        </div>
      ),
    },
    {
      header: "Due",
      cell: (row) => (row.dueAt ? fmt(row.dueAt) : "—"),
      width: "fit",
      sort: { asc: "dueAt", desc: "-dueAt", defaultDirection: "asc" },
    },
    {
      header: "",
      width: "fit",
      className: "pk-end",
      cell: (row) => (
        <RowActions
          // One person can have several rows, so the name also says which work it is.
          subject={`${row.title}, ${row.context}`}
          actions={
            row.retryable
              ? [{ id: "retry", label: "Retry now", onSelect: () => void retryNow(row), disabled: busyItem !== null }]
              : []
          }
        />
      ),
    },
  ];

  return (
    <div class="pk pk-stack pk-stack--snug">
      <PageHeader
        title={`${title} backlog`}
        trail={[
          { label: "Settings", href: "#/settings" },
          { label: "Scheduled jobs", href: "#/settings/scheduled-jobs" },
          { label: title },
        ]}
      />
      <p class="pk-small">Work this job has not finished yet. Each run picks up where the last one stopped.</p>
      <Panel>
        <ApiDataTable
          urlState="scheduled-job-backlog"
          caption={`${title} backlog`}
          endpoint={`/api/v1/scheduler/jobs/${encodeURIComponent(jobKey)}/backlog`}
          responseSchema={schedulerJobBacklogResponseSchema}
          resolve={(data) => data.items}
          resolvePage={(data) => data.page}
          paginate
          initialPageSize={25}
          initialSort="dueAt"
          searchPlaceholder="Search person or event…"
          load={loadPortalCollection}
          actionsRef={tableActions}
          columns={columns}
          empty="Nothing is waiting."
        />
      </Panel>
    </div>
  );
}
