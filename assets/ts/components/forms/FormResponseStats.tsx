/**
 * The per-field breakdown of a form's responses.
 *
 * Separate from the answer and submission views it used to share a file with:
 * that one answers "what did this person say", this one "what did everyone
 * say". They share only the option-label resolution, which lives in
 * `form-answers`.
 *
 * Every chart variant imports the canonical shared Chart.css here, including
 * pie, donut and word cloud, so standalone broadcasts never depend on portal styles.
 */

import { useMemo, useEffect, useState } from "preact/hooks";
import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import type { FormSubmissionStat } from "../../../shared/schemas/form-management";
import { VISUALIZATIONS, visualizationSchema, type Visualization } from "../../../shared/schemas/form-field-rules";
import { FilterSelect } from "../FilterSelect";
import { Button } from "../../ui/Button";
import { CloseButton } from "../../ui/CloseButton";
import { EmptyState } from "../../ui/EmptyState";
import { Meter } from "../../ui/Meter";
import { Panel, PanelBody } from "../../ui/Panel";
import { formatNumber } from "../../../shared/format-number";
import { isRecord } from "./form-answers";
// `pk-answer-list` and the `pk-chart__*` rows are written here as class names
// rather than reached through a component — `ui/chart.ts` emits HTML strings
// and this renders Preact — so this module has to pull both stylesheets into
// its own chunk.
import "../../ui/Content.css";
import "../../ui/Chart.css";

// A reader may choose any presentation the field rules accept; "auto" is the
// choice to let the field decide, so a rendered chart is one of the others.
type VisualizationChoice = Visualization;
export type VisualizationKind = Exclude<VisualizationChoice, "auto">;

/** What a chart reads from a field definition; a live poll's field carries no stored identity. */
export type StatField = Pick<FormFieldDefinition, "key" | "label" | "fieldType"> & {
  options?: FormFieldDefinition["options"];
  validation?: FormFieldDefinition["validation"];
};

interface FieldStat {
  field: StatField;
  totalAnswers: number;
  uniqueAnswers: number;
  visualization: VisualizationKind;
  entries: Array<{ label: string; count: number; percent: number; weight: number }>;
}

export type ServerFieldStat = FormSubmissionStat;

const CHART_SEGMENT_COUNT = 7;

/**
 * What the presentation picker calls each choice. These are the reader's
 * words, shorter than the author's in the field editor, and the map is total
 * on the contract's vocabulary so a new presentation cannot go unnamed.
 */
const PRESENTATION_LABELS: Record<VisualizationChoice, string> = {
  auto: "Auto",
  bar: "Bar",
  pie: "Pie",
  donut: "Donut",
  wordcloud: "Word cloud",
  list: "List",
};

function configuredVisualization(field: StatField): VisualizationKind | null {
  const validation = isRecord(field.validation) ? field.validation : null;
  const value = validation?.adminVisualization ?? validation?.visualization;
  const configured = visualizationSchema.safeParse(value);
  // "auto" is a deferral rather than a chart, so it reads the same as an
  // unconfigured field: the caller works the presentation out from the data.
  return configured.success && configured.data !== "auto" ? configured.data : null;
}

function autoVisualization(field: StatField, uniqueAnswers: number): VisualizationKind {
  const optionCount = Array.isArray(field.options) ? field.options.length : 0;
  if (field.fieldType === "boolean") return "pie";
  if (field.fieldType === "select") return optionCount > 5 ? "bar" : "pie";
  if (field.fieldType === "multi_select") return optionCount > 10 || uniqueAnswers > 8 ? "bar" : "pie";
  if (field.fieldType === "textarea") return "wordcloud";
  if (field.fieldType === "text" && uniqueAnswers > 10) return "wordcloud";
  return "list";
}

function mapServerStats(fields: readonly StatField[], stats: ServerFieldStat[]): FieldStat[] {
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

/**
 * The labeled bar breakdown, on the design system's chart rows.
 *
 * Each bar is the shared `Meter`, so a share of the whole is announced as a
 * meter with its own name and the value is never carried by length alone.
 * Its fill eases to a new width, which is what lets a chart fed by live
 * tallies grow as answers arrive and a refreshed report settle rather than
 * jump. Each row says its count and share in words beside the bar.
 */
function BarStat({ stat }: { stat: FieldStat }) {
  return (
    <div class="pk-chart__bars">
      {stat.entries.slice(0, 12).map((entry) => (
        <div class="pk-chart__bar-row" key={entry.label}>
          <span class="pk-chart__bar-label pk-break" title={entry.label}>
            {entry.label}
          </span>
          <Meter
            class="pk-chart__meter"
            value={entry.percent}
            label={`${entry.label}: ${formatNumber(entry.percent)}%`}
          />
          <span class="pk-chart__bar-count">
            {formatNumber(entry.count)} · {formatNumber(entry.percent)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function PieStat({ stat, donut = false }: { stat: FieldStat; donut?: boolean }) {
  let offset = 25;
  const entries = stat.entries;

  return (
    <div class="adm-form-pie-wrap">
      <svg
        class={`adm-form-pie ${donut ? "adm-form-pie--donut" : "adm-form-pie--solid"}`}
        viewBox="0 0 42 42"
        role="img"
        aria-label={`${stat.field.label} responses`}
      >
        <circle class="adm-form-pie-bg" cx="21" cy="21" r="15.915" />
        {entries.map((entry, index) => {
          const segmentOffset = offset;
          offset -= entry.percent;
          if (!donut) {
            const start = ((25 - segmentOffset) * Math.PI) / 50,
              end = start + (entry.percent * Math.PI) / 50;
            const x = (angle: number) => 21 + 20 * Math.cos(angle),
              y = (angle: number) => 21 + 20 * Math.sin(angle);
            const className = `adm-form-pie-sector adm-form-pie-sector-${index % CHART_SEGMENT_COUNT}`;
            if (entry.percent >= 100) return <circle key={entry.label} class={className} cx="21" cy="21" r="20" />;
            if (entry.percent <= 0) return null;
            return (
              <path
                key={entry.label}
                class={className}
                d={`M21,21 L${x(start)},${y(start)} A20,20 0 ${entry.percent > 50 ? 1 : 0},1 ${x(end)},${y(end)} Z`}
              />
            );
          }
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
            <span class="adm-form-pie-label" title={entry.label}>
              {entry.label}
            </span>
            <span class="adm-form-pie-count">({entry.count})</span>
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
  // `pk-answer-list` keeps the numbering while dropping the browser's 40px
  // indent and block margin, which is what `mb-0 ps-3` was doing by hand.
  return (
    <ol class="pk-answer-list pk-small">
      {stat.entries.slice(0, 12).map((entry) => (
        <li key={entry.label}>
          {entry.label} <span class="pk-muted">({entry.count})</span>
        </li>
      ))}
    </ol>
  );
}

function StatChartContent({ stat }: { stat: FieldStat }) {
  if (stat.visualization === "bar") return <BarStat stat={stat} />;
  if (stat.visualization === "pie") return <PieStat stat={stat} />;
  if (stat.visualization === "donut") return <PieStat stat={stat} donut />;
  if (stat.visualization === "wordcloud") return <WordCloudStat stat={stat} />;
  return <ListStat stat={stat} />;
}

/**
 * One field's results without the report card around them: the chart a live
 * poll's operator desk, its attendees and its broadcast overlay draw from
 * running tallies, and the one a report draws from stored answers.
 * `presentation` sizes the chart for a projector or broadcast frame: it takes
 * its type size from the surface around it.
 */
export function FormFieldStatChart({
  field,
  stat,
  visualization,
  presentation = false,
}: {
  field: StatField;
  stat: ServerFieldStat;
  visualization?: VisualizationKind;
  presentation?: boolean;
}) {
  const [mapped] = mapServerStats([field], [stat]);
  if (!mapped) return null;
  return (
    <div class={presentation ? "pk-chart pk-chart--presentation" : "pk-chart"}>
      <StatChartContent stat={visualization ? { ...mapped, visualization } : mapped} />
    </div>
  );
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
    // The row, the picker and the expand control were three bespoke legacy
    // rules with hard-coded whites and greys, so they stayed light in dark
    // mode. They are the design system's cluster, select and button now.
    //
    // `pk-break` on the heading block is what lets it shrink beside them: it
    // makes the label's minimum width its longest breakpoint rather than its
    // whole nowrap width. The label used to ellipsize with the full text only
    // in a `title`, which no keyboard or touch reader ever sees.
    <div class="pk-cluster pk-cluster--start">
      <div class="pk-stack pk-stack--tight pk-break">
        <span class="pk-strong">{stat.field.label}</span>
        <span class="pk-small">
          {stat.totalAnswers} answer{stat.totalAnswers === 1 ? "" : "s"} · {stat.uniqueAnswers} unique
        </span>
      </div>
      <div class="pk-cluster pk-push">
        <FilterSelect
          ariaLabel={`Presentation for ${stat.field.label}`}
          value={choice}
          options={VISUALIZATIONS.map((visualization) => ({
            value: visualization,
            // "Auto" says which presentation it resolved to, so the reader can
            // see what they are overriding before they override it.
            label:
              visualization === "auto"
                ? `${PRESENTATION_LABELS.auto} (${visualizationLabel})`
                : PRESENTATION_LABELS[visualization],
          }))}
          onChange={onChoiceChange}
        />
        {onExpand && (
          // The name says which chart it expands: a grid of these otherwise
          // offers a column of controls all called "Expand chart".
          <Button
            variant="ghost"
            icon
            aria-label={`Expand ${stat.field.label} chart`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onExpand();
            }}
          >
            <span aria-hidden="true">⤢</span>
          </Button>
        )}
      </div>
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
    // A grid item stretches to its row by default, so the explicit full-height
    // class is gone with the card. The panel's own body padding replaces the
    // legacy override that tuned Bootstrap's.
    <Panel aria-label={stat.field.label}>
      <PanelBody class="pk-stack pk-stack--snug">
        <StatCardHeader stat={stat} choice={choice} onChoiceChange={onChoiceChange} onExpand={onExpand} />
        <StatChartContent stat={stat} />
      </PanelBody>
    </Panel>
  );
}

export function FormResponseStats({
  fields,
  stats,
  total,
}: {
  fields: readonly StatField[];
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

  // The two absences are different claims — nobody has answered yet, versus
  // answers exist but nothing can be summarized from them — so each says
  // which. `EmptyState` announces itself; an italic grey line did not.
  if (!total)
    return (
      <div class="pk">
        <EmptyState title="No responses yet." body="Statistics appear here once someone submits this form." />
      </div>
    );
  if (!displayedStats.length)
    return (
      <div class="pk">
        <EmptyState
          title="No answer statistics available."
          body="Responses exist, but none of this form's fields can be summarized."
        />
      </div>
    );

  const expandedStat = expandedFieldKey
    ? (displayedStats.find((stat) => stat.field.key === expandedFieldKey) ?? null)
    : null;

  return (
    // Columns as many as fit, rather than a `col-md-6 col-xl-4` triplet and
    // the wrapper divs that carried it.
    <div class="pk pk-stack">
      <div class="pk-grid pk-grid--roomy">
        {displayedStats.map((stat) => (
          <FieldStatCard
            key={stat.field.key}
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
          <div class="adm-stat-modal pk-stack" onClick={(event) => event.stopPropagation()}>
            <CloseButton
              class="adm-stat-modal-close"
              label={`Close ${expandedStat.field.label} chart`}
              onClick={() => setExpandedFieldKey(null)}
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
    </div>
  );
}
