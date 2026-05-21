import { useMemo, useState } from "preact/hooks";
import { Table } from "../../../../components/Table";
import type { AdminFormDetailField, AdminFormSubmission } from "../../../types";
import { fmt } from "../../../ui";

export interface FormAnswerRow {
  key: string;
  label: string;
  values: string[];
  kind: "text" | "list" | "pre";
}

type VisualizationKind = "bar" | "pie" | "wordcloud" | "list";

interface FieldStat {
  field: AdminFormDetailField;
  totalAnswers: number;
  uniqueAnswers: number;
  visualization: VisualizationKind;
  entries: Array<{ label: string; count: number; percent: number; weight: number }>;
}

const CHART_SEGMENT_COUNT = 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionLabelMap(options: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!Array.isArray(options)) return labels;

  for (const entry of options) {
    if (typeof entry === "string") {
      labels.set(entry, entry);
      continue;
    }
    if (isRecord(entry) && typeof entry.value === "string") {
      labels.set(
        entry.value,
        typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : entry.value,
      );
    }
  }

  return labels;
}

function stringifyAnswer(value: unknown): string {
  if (typeof value === "string") return value.trim().length > 0 ? value : "-";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null) return "-";
  return JSON.stringify(value, null, 2);
}

export function formatFormAnswerValue(value: unknown, field?: AdminFormDetailField): string[] {
  const labels = optionLabelMap(field?.options);

  if (Array.isArray(value)) {
    if (value.length === 0) return ["-"];
    return value.map((entry) => (typeof entry === "string" ? (labels.get(entry) ?? entry) : stringifyAnswer(entry)));
  }

  if (typeof value === "string") return [labels.get(value) ?? stringifyAnswer(value)];
  return [stringifyAnswer(value)];
}

function answerKind(value: unknown, formatted: string[]): FormAnswerRow["kind"] {
  if (Array.isArray(value) && formatted.length > 1) return "list";
  if ((isRecord(value) || (Array.isArray(value) && formatted.length === 1)) && formatted[0] !== "-") return "pre";
  if (formatted.some((entry) => entry.includes("\n"))) return "pre";
  return "text";
}

export function buildFormAnswerRows(
  answers: Record<string, unknown> | null | undefined,
  fields: AdminFormDetailField[] | null | undefined,
): FormAnswerRow[] {
  if (!answers || Object.keys(answers).length === 0) return [];

  const rows: FormAnswerRow[] = [];
  const fieldMap = new Map((fields ?? []).map((field) => [field.key, field]));
  const seen = new Set<string>();

  for (const field of fields ?? []) {
    if (!(field.key in answers)) continue;
    const rawValue = answers[field.key];
    const formatted = formatFormAnswerValue(rawValue, field);
    rows.push({ key: field.key, label: field.label, values: formatted, kind: answerKind(rawValue, formatted) });
    seen.add(field.key);
  }

  for (const key of Object.keys(answers).sort()) {
    if (seen.has(key)) continue;
    const rawValue = answers[key];
    const field = fieldMap.get(key);
    const formatted = formatFormAnswerValue(rawValue, field);
    rows.push({ key, label: field?.label ?? key, values: formatted, kind: answerKind(rawValue, formatted) });
  }

  return rows;
}

export function FormAnswerTable({
  answers,
  fields,
  empty = "No form answers recorded.",
}: {
  answers: Record<string, unknown> | null | undefined;
  fields: AdminFormDetailField[] | null | undefined;
  empty?: string;
}) {
  const rows = buildFormAnswerRows(answers, fields);

  if (!rows.length) return <p class="small text-body-secondary fst-italic mb-0">{empty}</p>;

  return (
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th class="text-muted fw-semibold ps-3 adm-table-label-col" scope="row">
                {row.label}
              </th>
              <td class="pe-3">
                {row.kind === "list" ? (
                  <ul class="small mb-0 ps-3">
                    {row.values.map((value, index) => (
                      <li key={index}>{value}</li>
                    ))}
                  </ul>
                ) : row.kind === "pre" ? (
                  <pre class="small bg-light border rounded p-2 mb-0 adm-pre-wrap">{row.values[0]}</pre>
                ) : (
                  <span class="small">{row.values[0]}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function configuredVisualization(field: AdminFormDetailField): VisualizationKind | null {
  const validation = isRecord(field.validation) ? field.validation : null;
  const value = validation?.adminVisualization ?? validation?.visualization;
  return value === "bar" || value === "pie" || value === "wordcloud" || value === "list" ? value : null;
}

function autoVisualization(field: AdminFormDetailField, uniqueAnswers: number): VisualizationKind {
  const optionCount = Array.isArray(field.options) ? field.options.length : 0;
  if (field.fieldType === "boolean") return "pie";
  if (field.fieldType === "select") return optionCount > 5 ? "bar" : "pie";
  if (field.fieldType === "multi_select") return optionCount > 10 || uniqueAnswers > 8 ? "bar" : "pie";
  if (field.fieldType === "textarea") return "wordcloud";
  if (field.fieldType === "text" && uniqueAnswers > 10) return "wordcloud";
  return "list";
}

function extractStatValues(value: unknown, field: AdminFormDetailField): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return formatFormAnswerValue(value, field).filter((entry) => entry !== "-");
  if (typeof value === "string" && field.fieldType === "textarea") {
    return value
      .split(/[,;\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return formatFormAnswerValue(value, field).filter((entry) => entry !== "-");
}

function buildFieldStats(fields: AdminFormDetailField[], submissions: AdminFormSubmission[]): FieldStat[] {
  return fields
    .map((field) => {
      const counts = new Map<string, number>();
      let totalAnswers = 0;

      for (const submission of submissions) {
        const values = extractStatValues(submission.answers[field.key], field);
        if (values.length === 0) continue;
        totalAnswers += 1;
        for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      }

      const maxCount = Math.max(1, ...counts.values());
      const countedValues = Array.from(counts.values()).reduce((sum, count) => sum + count, 0) || 1;
      const entries = Array.from(counts.entries())
        .map(([label, count]) => ({
          label,
          count,
          percent: Math.round((count / countedValues) * 100),
          weight: count / maxCount,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

      return {
        field,
        totalAnswers,
        uniqueAnswers: entries.length,
        visualization: configuredVisualization(field) ?? autoVisualization(field, entries.length),
        entries,
      };
    })
    .filter((stat) => stat.entries.length > 0);
}

function BarStat({ stat }: { stat: FieldStat }) {
  return (
    <div class="adm-form-stat-bars">
      {stat.entries.slice(0, 12).map((entry) => (
        <div class="bar-row" key={entry.label}>
          <div class="bar-lbl text-truncate" title={entry.label}>
            {entry.label}
          </div>
          <meter
            class="adm-form-meter"
            min={0}
            max={100}
            value={Math.max(4, entry.percent)}
            title={`${entry.percent}%`}
          />
          <div class="bar-cnt">{entry.count}</div>
        </div>
      ))}
    </div>
  );
}

function PieStat({ stat }: { stat: FieldStat }) {
  let offset = 25;
  const entries = stat.entries.slice(0, CHART_SEGMENT_COUNT);

  return (
    <div class="adm-form-pie-wrap">
      <svg class="adm-form-pie" viewBox="0 0 42 42" role="img" aria-label={`${stat.field.label} responses`}>
        <circle class="adm-form-pie-bg" cx="21" cy="21" r="15.915" />
        {entries.map((entry, index) => {
          const segmentOffset = offset;
          offset -= entry.percent;
          return (
            <circle
              key={entry.label}
              class={`adm-form-pie-segment adm-form-pie-segment-${index % CHART_SEGMENT_COUNT}`}
              cx="21"
              cy="21"
              r="15.915"
              stroke-dasharray={`${entry.percent} ${100 - entry.percent}`}
              stroke-dashoffset={segmentOffset}
            />
          );
        })}
      </svg>
      <div class="adm-form-pie-legend">
        {entries.map((entry, index) => (
          <span class="adm-form-pie-legend-item" key={entry.label}>
            <span class={`adm-form-pie-dot adm-form-pie-dot-${index % CHART_SEGMENT_COUNT}`} />
            {entry.label} ({entry.count})
          </span>
        ))}
      </div>
    </div>
  );
}

function WordCloudStat({ stat }: { stat: FieldStat }) {
  return (
    <div class="adm-form-wordcloud">
      {stat.entries.slice(0, 28).map((entry) => (
        <span
          key={entry.label}
          class={`adm-word-weight-${Math.max(1, Math.ceil(entry.weight * 5))}`}
          data-count={`${entry.count} answer${entry.count === 1 ? "" : "s"}`}
        >
          {entry.label}
        </span>
      ))}
    </div>
  );
}

function ListStat({ stat }: { stat: FieldStat }) {
  return (
    <ol class="small mb-0 ps-3">
      {stat.entries.slice(0, 12).map((entry) => (
        <li key={entry.label}>
          {entry.label} <span class="text-muted">({entry.count})</span>
        </li>
      ))}
    </ol>
  );
}

function FieldStatCard({ stat }: { stat: FieldStat }) {
  return (
    <div class="card h-100 adm-form-stat-card">
      <div class="card-body p-3">
        <div class="d-flex align-items-start gap-2 mb-2">
          <div class="min-w-0">
            <h6 class="mb-0 text-truncate" title={stat.field.label}>
              {stat.field.label}
            </h6>
            <div class="small text-muted">
              {stat.totalAnswers} answer{stat.totalAnswers === 1 ? "" : "s"} · {stat.uniqueAnswers} unique
            </div>
          </div>
          <span class="badge text-bg-light border text-body ms-auto">{stat.visualization}</span>
        </div>
        {stat.visualization === "bar" && <BarStat stat={stat} />}
        {stat.visualization === "pie" && <PieStat stat={stat} />}
        {stat.visualization === "wordcloud" && <WordCloudStat stat={stat} />}
        {stat.visualization === "list" && <ListStat stat={stat} />}
      </div>
    </div>
  );
}

export function FormResponseStats({
  fields,
  submissions,
}: {
  fields: AdminFormDetailField[];
  submissions: AdminFormSubmission[];
}) {
  const stats = useMemo(() => buildFieldStats(fields, submissions), [fields, submissions]);

  if (!submissions.length) return <p class="small text-body-secondary fst-italic mb-0">No responses yet.</p>;
  if (!stats.length) return <p class="small text-body-secondary fst-italic mb-0">No answer statistics available.</p>;

  return (
    <div class="row g-3">
      {stats.map((stat) => (
        <div class="col-md-6 col-xl-4" key={stat.field.key}>
          <FieldStatCard stat={stat} />
        </div>
      ))}
    </div>
  );
}

export function FormSubmissionsTable({
  fields,
  submissions,
}: {
  fields: AdminFormDetailField[];
  submissions: AdminFormSubmission[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Table
      heads={["Submitted", "Submitter", "Context", "Status", { label: "Answers", className: "text-end" }, ""]}
      empty="No responses found"
    >
      {submissions.length > 0 &&
        submissions.map((submission) => {
          const submitter = submission.submitter;
          const name = [submitter?.firstName, submitter?.lastName].filter(Boolean).join(" ");
          const expanded = expandedId === submission.id;
          return (
            <>
              <tr key={submission.id}>
                <td class="mono small">{fmt(submission.submittedAt)}</td>
                <td>
                  <span class="small">{name || submitter?.email || "-"}</span>
                  {name && submitter?.email && (
                    <>
                      <br />
                      <span class="text-muted small">{submitter.email}</span>
                    </>
                  )}
                </td>
                <td class="small">{submission.contextType ?? "-"}</td>
                <td>
                  <span class="badge text-bg-secondary">{submission.status}</span>
                </td>
                <td class="mono text-end">{Object.keys(submission.answers ?? {}).length}</td>
                <td>
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    onClick={() => setExpandedId(expanded ? null : submission.id)}
                  >
                    {expanded ? "Hide" : "View"}
                  </button>
                </td>
              </tr>
              {expanded && (
                <tr key={`${submission.id}-detail`}>
                  <td colspan={6} class="p-0">
                    <div class="p-3 bg-light border-top">
                      <FormAnswerTable answers={submission.answers} fields={fields} />
                    </div>
                  </td>
                </tr>
              )}
            </>
          );
        })}
    </Table>
  );
}
