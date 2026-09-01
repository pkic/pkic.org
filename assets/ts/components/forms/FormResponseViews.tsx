/**
 * What one person answered: as a list on a detail page, and as a page of rows
 * in the submissions table. The aggregate view lives in `FormResponseStats`.
 */

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import type { z } from "zod";
import type { FormSubmission } from "../../../shared/schemas/form-management";
import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import type { PageInfo } from "../../../shared/schemas/pagination";
import { formatDateTime } from "../../shared/ui";
import { ApiDataTable } from "../ApiDataTable";
import { Badge } from "../Badge";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { PanelBody } from "../../ui/Panel";
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
}: {
  fields: FormFieldDefinition[];
  endpoint: string;
  responseSchema: z.ZodType<Response>;
  params?: Record<string, string>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  }));

  return (
    <ApiDataTable
      caption="Form responses"
      endpoint={endpoint}
      responseSchema={responseSchema}
      resolve={(data) => data.submissions}
      resolvePage={(data) => data.page}
      paginate
      initialSort="-submitted_at"
      params={params}
      empty={<EmptyState title="No responses found" body="Nothing has been submitted through this form yet." />}
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
            const expanded = expandedId === submission.id;
            const who =
              [submission.submitter?.firstName, submission.submitter?.lastName].filter(Boolean).join(" ") ||
              submission.submitter?.email ||
              "this response";
            return (
              // The control names the response it opens: a page of rows
              // otherwise offers a column of buttons all called "View".
              <Button
                size="sm"
                aria-label={`${expanded ? "Hide" : "View"} answers from ${who}`}
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : submission.id)}
              >
                {expanded ? "Hide" : "View"}
              </Button>
            );
          },
        },
      ]}
      detailRow={(submission) =>
        expandedId === submission.id ? (
          // The expanded cell has no padding of its own — DataTable zeroes it
          // so the row's owner decides — so the panel body supplies it on the
          // space scale rather than a one-off padding utility.
          <PanelBody>
            <FormAnswerTable answers={submission.answers} fields={fields} />
          </PanelBody>
        ) : null
      }
    />
  );
}
