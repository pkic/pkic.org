/**
 * What one person answered: as a list on a detail page, and as a page of rows
 * in the submissions table. The aggregate view lives in `FormResponseStats`.
 */

import { Fragment } from "preact";
import type { z } from "zod";
import { formSubmissionsExportQuerySchema } from "../../../shared/schemas/form-management";
import { FilterSelect } from "../FilterSelect";
import { DownloadAction } from "../../ui/DownloadAction";
import type { FormSubmission } from "../../../shared/schemas/form-management";
import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import type { PageInfo } from "../../../shared/schemas/pagination";
import { formatDateTime } from "../../shared/ui";
import { ApiDataTable, type ApiDataTableProps } from "../ApiDataTable";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import { useData } from "../../hooks/useData";
import { getJson } from "../../shared/api-client";
import { Button } from "../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Badge } from "../Badge";
import { EmptyState } from "../../ui/EmptyState";
import { RowActions } from "../../ui/RowActions";
import { buildFormAnswerRows, formatFormAnswerValue } from "./form-answers";
// `pk-datalist`, `pk-answer-list`, `pk-code-block`, `pk-answer-pre` and
// `pk-mono` are written here as class names rather than reached through a
// component, so this module has to pull their stylesheet into its own chunk.
import "../../ui/Content.css";

export function FormAnswerTable({
  answers,
  fields,
  empty = "No form answers recorded.",
}: {
  answers: Record<string, unknown> | null | undefined;
  fields: FormFieldDefinition[] | null | undefined;
  empty?: string;
}) {
  const rows = buildFormAnswerRows(answers, fields);

  if (!rows.length) return <p class="pk-small">{empty}</p>;

  /*
   * A description list, not a table.
   *
   * These are one submission's answers — label and value, once each — which is
   * what a `dl` is for. It was a two-column `<table>` with no caption, and
   * because it renders inside another table's expanded row, a screen reader
   * found a named table containing an unnamed one and announced a grid where
   * there was only a list of answers.
   */
  return (
    <dl class="pk-datalist pk-small">
      {rows.map((row) => (
        <Fragment key={row.key}>
          <dt>{row.label}</dt>
          <dd>
            {row.kind === "list" ? (
              <ul class="pk-answer-list">
                {row.values.map((value, index) => (
                  <li key={index}>{value}</li>
                ))}
              </ul>
            ) : row.kind === "pre" ? (
              <pre class="pk-code-block pk-answer-pre">{row.values[0]}</pre>
            ) : (
              row.values[0]
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function compactAnswer(value: unknown, field: FormFieldDefinition): { text: string; title: string } {
  const values = formatFormAnswerValue(value, field).filter((entry) => entry !== "-");
  const text = values.length ? values.join(", ") : "-";
  return { text: text.length > 90 ? `${text.slice(0, 87)}...` : text, title: text };
}

export function FormSubmissionsTable<Response extends { submissions: FormSubmission[]; page: PageInfo }>({
  fields,
  endpoint,
  responseSchema,
  params,
  onOpen,
  exportEndpoint,
  load,
}: {
  fields: FormFieldDefinition[];
  endpoint: string;
  exportEndpoint?: string;
  load?: ApiDataTableProps<FormSubmission, Response>["load"];
  responseSchema: z.ZodType<Response>;
  params?: Record<string, string>;
  onOpen: (submission: FormSubmission) => void;
}) {
  const answerColumns = fields.map((field) => ({
    header: { label: field.label, className: "adm-form-answer-col" },
    cell: (submission: FormSubmission) => {
      const answer = compactAnswer(submission.answers?.[field.key], field);
      return (
        <span class="pk-small adm-form-answer-cell" title={answer.title}>
          {answer.text}
        </span>
      );
    },
    className: "adm-form-answer-col",
    sort: { asc: `answer:${field.key}`, desc: `-answer:${field.key}` },
  }));

  return (
    <ApiDataTable
      urlState="form-responses"
      caption="Form responses"
      endpoint={endpoint}
      load={load}
      responseSchema={responseSchema}
      resolve={(data) => data.submissions}
      resolvePage={(data) => data.page}
      paginate
      initialSort="-submitted_at"
      params={params}
      toolbar={(actions, query) => {
        const selected = fields.find((field) => field.key === query.answerField);
        const options = selected?.options ?? [];
        const exportQuery = formSubmissionsExportQuerySchema.safeParse({
          ...query,
          ...(selected ? { field: selected.key } : {}),
        });
        const exportParams = new URLSearchParams(
          exportQuery.success ? Object.entries(exportQuery.data).map(([key, value]) => [key, String(value)]) : [],
        );
        return (
          <>
            <FilterSelect
              ariaLabel="Filter answer field"
              value={query.answerField ?? ""}
              options={[
                { value: "", label: "All answer fields" },
                ...fields
                  .filter((field) => (field.options?.length ?? 0) > 0)
                  .map((field) => ({ value: field.key, label: field.label })),
              ]}
              onChange={(value) => actions.setFilters?.({ answerField: value, answerValue: "" })}
            />
            {options.length > 0 && (
              <FilterSelect
                ariaLabel={`Filter ${selected?.label}`}
                value={query.answerValue ?? ""}
                options={[{ value: "", label: "All answers" }, ...options]}
                onChange={(value) => actions.setFilter?.("answerValue", value)}
              />
            )}
            {exportEndpoint && (
              <DownloadAction
                label={selected ? `Download ${selected.label} (CSV)` : "Download responses (CSV)"}
                href={`${exportEndpoint}?${exportParams}`}
                disabled={!exportQuery.success}
              />
            )}
          </>
        );
      }}
      empty={<EmptyState title="No responses found" body="Try changing your search or filters." />}
      rowKey={(submission) => submission.id}
      columns={[
        {
          header: "Submitter",
          cell: (submission) => {
            const submitter = submission.submitter;
            const name = [submitter?.firstName, submitter?.lastName].filter(Boolean).join(" ");
            return (
              // A stack rather than a `<br>`: the two lines are two values,
              // and the gap between them is the stack's rather than a line
              // break's whim.
              <span class="pk-stack pk-stack--tight">
                <span class="pk-small">{name || submitter?.email || "-"}</span>
                {name && submitter?.email && <span class="pk-muted pk-small">{submitter.email}</span>}
              </span>
            );
          },
          className: "adm-form-submitter-col",
          sort: { asc: "submitter", desc: "-submitter" },
        },
        ...answerColumns,
        {
          header: "Submitted",
          cell: (submission) => formatDateTime(submission.submittedAt),
          className: "pk-mono pk-small pk-nowrap",
          sort: { asc: "submitted_at", desc: "-submitted_at", defaultDirection: "desc" },
        },
        {
          header: "Status",
          cell: (submission) => <Badge status={submission.status} />,
          sort: { asc: "status", desc: "-status" },
        },
        {
          header: "",
          className: "pk-end",
          cell: (submission) => {
            const who =
              [submission.submitter?.firstName, submission.submitter?.lastName].filter(Boolean).join(" ") ||
              submission.submitter?.email ||
              "this response";
            return (
              <RowActions
                subject={who}
                actions={[{ id: "open", label: "Open response", onSelect: () => onOpen(submission) }]}
              />
            );
          },
        },
      ]}
    />
  );
}

export function FormSubmissionRecord<Response extends { submissions: FormSubmission[]; page: PageInfo }>({
  fields,
  endpoint,
  responseSchema,
  responseId,
  onBack,
}: {
  fields: FormFieldDefinition[];
  endpoint: string;
  responseSchema: z.ZodType<Response>;
  responseId: string;
  onBack: () => void;
}) {
  const detail = useData(
    () => getJson(`${endpoint}?limit=1&responseId=${encodeURIComponent(responseId)}`, responseSchema),
    [endpoint, responseId],
  );
  if (detail.loading) return <Spinner label="Loading response…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  const submission = detail.data?.submissions[0];
  if (!submission) return <ErrorAlert error="This response is not available." />;
  const who =
    [submission.submitter?.firstName, submission.submitter?.lastName].filter(Boolean).join(" ") ||
    submission.submitter?.email ||
    "Response";
  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button onClick={onBack}>← All responses</Button>
      </div>
      <Panel>
        <PanelHeader title={who} />
        <PanelBody>
          <FormAnswerTable answers={submission.answers} fields={fields} />
        </PanelBody>
      </Panel>
    </div>
  );
}
