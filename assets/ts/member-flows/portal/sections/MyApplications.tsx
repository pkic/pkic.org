/**
 * My Application — View original application, status history,
 * and timeline. Most members have exactly one application, but the backend
 * (GET /api/v1/users/current/applications) returns every application matching the
 * caller's email, so this renders as a list that expands into a detail view
 * (master/detail within a single tab — no route param, since
 * scoped the nav shell's routing to top-level sections only).
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../../../shared/api-client";
import { myApplicationDetailSchema, myApplicationsListResponseSchema } from "../../../../shared/schemas/me";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { useApiPage } from "../../../hooks/useApiPage";
import { fmt, fmtDate } from "../ui";
import { Badge, statusLabel } from "../../../components/Badge";
import { Button } from "../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../ui/DataTable";
import { EmptyState } from "../../../ui/EmptyState";
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import type { MyApplicationDetail, MyApplicationSummary } from "../types";
import { useMembershipCategoryLabels } from "../../../hooks/useMembershipCategoryLabels";

/**
 * One entry in the status history or the message list. Both are a headline
 * with a timestamp opposite it and an optional block of prose underneath, so
 * the shape is defined once rather than twice.
 */
function LogEntry({ headline, at, body }: { headline: ComponentChildren; at: string; body?: string | null }) {
  return (
    <li class="pk-stack pk-stack--tight">
      <div class="pk-cluster pk-cluster--between pk-cluster--start">
        <span>{headline}</span>
        <span class="pk-muted pk-small pk-nowrap">{fmt(at)}</span>
      </div>
      {body && <p class="pk-small">{body}</p>}
    </li>
  );
}

function ApplicationDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<MyApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { label: categoryLabel } = useMembershipCategoryLabels();

  useEffect(() => {
    let cancelled = false;
    getJson(`/api/v1/users/current/applications/${id}`, myApplicationDetailSchema)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiClientError ? e.message : "Could not load this application.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div class="pk pk-stack">
      {/* The applicant heads the page; the way back rides in the header's
          action slot because the detail has no URL of its own for a trail
          link to point at — it is the same page, expanded. */}
      {detail ? (
        <PageHeader
          title={detail.applicantName}
          context={<Badge status={detail.stage} />}
          actions={
            <Button size="sm" variant="ghost" onClick={onBack}>
              Back to applications
            </Button>
          }
        />
      ) : (
        <div class="pk-cluster">
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to applications
          </Button>
        </div>
      )}
      {error && <ErrorAlert error={error} />}
      {!detail && !error ? (
        <Spinner label="Loading your application…" />
      ) : (
        detail && (
          <>
            <Panel>
              <PanelBody class="pk-stack pk-stack--tight">
                <p class="pk-muted pk-small">
                  {detail.organizationName ?? "Individual applicant"} — {categoryLabel(detail.membershipCategory)}
                </p>
                <p class="pk-muted pk-small">
                  Submitted {fmt(detail.createdAt)} — last updated {fmt(detail.stageEnteredAt)}
                </p>
              </PanelBody>
            </Panel>

            <Panel>
              <PanelHeader title="Status history" />
              <PanelBody>
                {detail.timeline.length === 0 ? (
                  <EmptyState
                    title="No status changes yet."
                    body="Every decision on this application will be recorded here."
                  />
                ) : (
                  <ul class="pk-stack pk-stack--snug">
                    {detail.timeline.map((entry, i) => (
                      <LogEntry
                        key={i}
                        at={entry.createdAt}
                        body={entry.note}
                        headline={
                          <>
                            {entry.fromStage ? `${statusLabel(entry.fromStage)} → ` : ""}
                            <strong>{statusLabel(entry.toStage)}</strong>
                          </>
                        }
                      />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>

            {detail.communications.length > 0 && (
              <Panel>
                <PanelHeader title="Messages" />
                <PanelBody>
                  <ul class="pk-stack pk-stack--snug">
                    {detail.communications.map((entry, i) => (
                      <LogEntry
                        key={i}
                        at={entry.createdAt}
                        body={entry.body}
                        headline={<strong>{entry.subject ?? "Message"}</strong>}
                      />
                    ))}
                  </ul>
                </PanelBody>
              </Panel>
            )}
          </>
        )
      )}
    </div>
  );
}

function applicationColumns(
  categoryLabel: (code: string) => string,
): ReadonlyArray<DataTableColumn<MyApplicationSummary>> {
  return [
    // The design system's table gives slack to no column on its own; the
    // category is the row's subject, so a wide screen's slack lands there —
    // and it reads as the catalog's words, not a bare letter code.
    {
      id: "membershipCategory",
      header: "Category",
      width: "primary",
      cell: (app) => categoryLabel(app.membershipCategory),
    },
    // The badge carries the status as words as well as a tone, so the column is
    // readable without relying on colour.
    { id: "stage", header: "Status", cell: (app) => <Badge status={app.stage} /> },
    {
      id: "createdAt",
      header: "Submitted",
      cell: (app) => fmtDate(app.createdAt),
      // A date has a bounded length; saying so keeps the slack in the
      // category column instead of stranding the date mid-screen.
      width: "fit",
    },
  ];
}

export function MyApplications() {
  const page = useApiPage(
    "/api/v1/users/current/applications",
    { sort: "-createdAt" },
    myApplicationsListResponseSchema,
    (data) => data.applications,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const categories = useMembershipCategoryLabels((page.data?.applications.length ?? 0) > 0);

  if (selectedId) {
    return <ApplicationDetailView id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  if (page.error) {
    return (
      <ErrorAlert error={page.error instanceof Error ? page.error.message : "Could not load your applications."} />
    );
  }
  if (!page.data) return <Spinner label="Loading your applications…" />;
  const applications = page.data.applications;

  return (
    <div class="pk pk-stack">
      <PageHeader title="My application" />
      <Panel>
        <PanelBody>
          <DataTable
            caption="Your membership applications"
            columns={applicationColumns(categories.label)}
            rows={applications}
            rowKey={(app) => app.id}
            loading={page.loading}
            // The row's activation is a real control stretched over the row,
            // not a click handler on the `<tr>`: a row is not focusable and
            // takes no Enter key, so the handler this replaces could only be
            // reached with a mouse.
            rowAction={(app) => ({
              label: `Open the application submitted ${fmtDate(app.createdAt)}`,
              onSelect: () => setSelectedId(app.id),
            })}
            empty={
              <EmptyState
                title="No membership application is on file for your account."
                body="An application you submit appears here as soon as it reaches us."
              />
            }
          />
          {page.pagerProps && <Pager {...page.pagerProps} />}
        </PanelBody>
      </Panel>
    </div>
  );
}
