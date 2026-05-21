import { useMemo, useEffect, useState } from "preact/hooks";
import { ApiDataTable } from "../../../../components/Table";
import type { AdminFormDetailField, AdminFormSubmission } from "../../../types";
import { fmt } from "../../../ui";

export interface FormAnswerRow {
  key: string;
  label: string;
  values: string[];
  kind: "text" | "list" | "pre";
}

type VisualizationKind = "bar" | "pie" | "wordcloud" | "list";
type VisualizationChoice = "auto" | VisualizationKind;

interface FieldStat {
  field: AdminFormDetailField;
  totalAnswers: number;
  uniqueAnswers: number;
  visualization: VisualizationKind;
  entries: Array<{ label: string; count: number; percent: number; weight: number }>;
}

export interface ServerFieldStat {
  fieldKey: string;
  totalAnswers: number;
  uniqueAnswers: number;
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

function mapServerStats(fields: AdminFormDetailField[], stats: ServerFieldStat[]): FieldStat[] {
  const fieldMap = new Map(fields.map((field) => [field.key, field]));
  return stats
    .map((stat) => {
      const field = fieldMap.get(stat.fieldKey);
      if (!field) return null;
      return {
        field,
        totalAnswers: stat.totalAnswers,
        uniqueAnswers: stat.uniqueAnswers,
        visualization: configuredVisualization(field) ?? autoVisualization(field, stat.uniqueAnswers),
        entries: stat.entries,
      } satisfies FieldStat;
    })
    .filter((stat): stat is FieldStat => stat !== null);
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

function StatChartContent({ stat }: { stat: FieldStat }) {
  if (stat.visualization === "bar") return <BarStat stat={stat} />;
  if (stat.visualization === "pie") return <PieStat stat={stat} />;
  if (stat.visualization === "wordcloud") return <WordCloudStat stat={stat} />;
  return <ListStat stat={stat} />;
}

function compactAnswer(value: unknown, field: AdminFormDetailField): { text: string; title: string } {
  const values = formatFormAnswerValue(value, field).filter((entry) => entry !== "-");
  const text = values.length ? values.join(", ") : "-";
  return { text: text.length > 90 ? `${text.slice(0, 87)}...` : text, title: text };
}

function StatCardHeader({
  stat,
  choice,
  onChoiceChange,
  onExpand,
}: {
  stat: FieldStat;
  choice: VisualizationChoice;
  onChoiceChange: (choice: VisualizationChoice) => void;
  onExpand?: () => void;
}) {
  const visualizationLabel = stat.visualization[0].toUpperCase() + stat.visualization.slice(1);

  return (
    <div class="adm-stat-card-header">
      <div class="min-w-0 flex-grow-1">
        <div class="adm-stat-card-title mb-0" title={stat.field.label}>
          {stat.field.label}
        </div>
        <div class="adm-stat-card-meta">
          {stat.totalAnswers} answer{stat.totalAnswers === 1 ? "" : "s"} · {stat.uniqueAnswers} unique
        </div>
      </div>
      <select
        class="adm-stat-select"
        value={choice}
        aria-label={`Presentation for ${stat.field.label}`}
        onChange={(event) => onChoiceChange((event.target as HTMLSelectElement).value as VisualizationChoice)}
      >
        <option value="auto">Auto ({visualizationLabel})</option>
        <option value="bar">Bar</option>
        <option value="pie">Pie</option>
        <option value="wordcloud">Word cloud</option>
        <option value="list">List</option>
      </select>
      {onExpand && (
        <button
          type="button"
          class="adm-stat-expand-btn"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onExpand();
          }}
          title="Expand"
          aria-label="Expand chart"
        >
          ⤢
        </button>
      )}
    </div>
  );
}

function FieldStatCard({
  stat,
  choice,
  onChoiceChange,
  onExpand,
}: {
  stat: FieldStat;
  choice: VisualizationChoice;
  onChoiceChange: (choice: VisualizationChoice) => void;
  onExpand: () => void;
}) {
  return (
    <div class="card h-100 adm-form-stat-card">
      <div class="card-body">
        <StatCardHeader stat={stat} choice={choice} onChoiceChange={onChoiceChange} onExpand={onExpand} />
        <StatChartContent stat={stat} />
      </div>
    </div>
  );
}

export function FormResponseStats({
  fields,
  stats,
  total,
}: {
  fields: AdminFormDetailField[];
  stats: ServerFieldStat[];
  total: number;
}) {
  const fieldStats = useMemo(() => mapServerStats(fields, stats), [fields, stats]);
  const [presentationByField, setPresentationByField] = useState<Record<string, VisualizationChoice>>({});
  const [expandedFieldKey, setExpandedFieldKey] = useState<string | null>(null);
  const displayedStats = useMemo(
    () =>
      fieldStats.map((stat) => {
        const choice = presentationByField[stat.field.key] ?? "auto";
        return choice === "auto" ? stat : { ...stat, visualization: choice };
      }),
    [fieldStats, presentationByField],
  );

  useEffect(() => {
    if (!expandedFieldKey) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedFieldKey(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expandedFieldKey]);

  if (!total) return <p class="small text-body-secondary fst-italic mb-0">No responses yet.</p>;
  if (!displayedStats.length)
    return <p class="small text-body-secondary fst-italic mb-0">No answer statistics available.</p>;

  const expandedStat = expandedFieldKey
    ? (displayedStats.find((stat) => stat.field.key === expandedFieldKey) ?? null)
    : null;

  return (
    <>
      <div class="row g-3">
        {displayedStats.map((stat) => (
          <div class="col-md-6 col-xl-4" key={stat.field.key}>
            <FieldStatCard
              stat={stat}
              choice={presentationByField[stat.field.key] ?? "auto"}
              onChoiceChange={(choice) =>
                setPresentationByField((current) => ({
                  ...current,
                  [stat.field.key]: choice,
                }))
              }
              onExpand={() => setExpandedFieldKey((current) => (current === stat.field.key ? null : stat.field.key))}
            />
          </div>
        ))}
      </div>
      {expandedStat && (
        <div
          class="adm-stat-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={expandedStat.field.label}
          onClick={() => setExpandedFieldKey(null)}
        >
          <div class="adm-stat-modal" onClick={(event) => event.stopPropagation()}>
            <button
              class="btn-close adm-stat-modal-close"
              onClick={() => setExpandedFieldKey(null)}
              aria-label="Close"
            />
            <StatCardHeader
              stat={expandedStat}
              choice={presentationByField[expandedStat.field.key] ?? "auto"}
              onChoiceChange={(choice) =>
                setPresentationByField((current) => ({
                  ...current,
                  [expandedStat.field.key]: choice,
                }))
              }
            />
            <div class="adm-stat-modal-chart">
              <StatChartContent stat={expandedStat} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function FormSubmissionsTable({
  fields,
  endpoint,
  params,
  deps = [],
}: {
  fields: AdminFormDetailField[];
  endpoint: string;
  params?: Record<string, string>;
  deps?: unknown[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const answerColumns = fields.map((field) => ({
    header: { label: field.label, className: "adm-form-answer-col" },
    cell: (submission: AdminFormSubmission) => {
      const answer = compactAnswer(submission.answers?.[field.key], field);
      return (
        <span class="small adm-form-answer-cell" title={answer.title}>
          {answer.text}
        </span>
      );
    },
    className: "adm-form-answer-col",
  }));

  return (
    <ApiDataTable<AdminFormSubmission>
      endpoint={endpoint}
      resolve={(data) => (data as { submissions: AdminFormSubmission[] }).submissions}
      resolvePage={(data) => (data as { page: { total: number; hasMore: boolean } }).page}
      paginate
      params={params}
      deps={deps}
      empty="No responses found"
      rowKey={(submission) => submission.id}
      columns={[
        {
          header: "Submitter",
          cell: (submission) => {
            const submitter = submission.submitter;
            const name = [submitter?.firstName, submitter?.lastName].filter(Boolean).join(" ");
            return (
              <>
                <span class="small">{name || submitter?.email || "-"}</span>
                {name && submitter?.email && (
                  <>
                    <br />
                    <span class="text-muted small">{submitter.email}</span>
                  </>
                )}
              </>
            );
          },
          className: "adm-form-submitter-col",
        },
        ...answerColumns,
        { header: "Submitted", cell: (submission) => fmt(submission.submittedAt), className: "mono small" },
        {
          header: "Status",
          cell: (submission) => <span class="badge text-bg-secondary">{submission.status}</span>,
        },
        {
          header: "",
          cell: (submission) => {
            const expanded = expandedId === submission.id;
            return (
              <button
                class="btn btn-sm btn-outline-secondary"
                onClick={() => setExpandedId(expanded ? null : submission.id)}
              >
                {expanded ? "Hide" : "View"}
              </button>
            );
          },
        },
      ]}
      detailRow={(submission) =>
        expandedId === submission.id ? (
          <div class="p-3 bg-light border-top">
            <FormAnswerTable answers={submission.answers} fields={fields} />
          </div>
        ) : null
      }
    />
  );
}
