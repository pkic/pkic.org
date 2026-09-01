/**
 * The per-field breakdown of a form's responses.
 *
 * Separate from the answer and submission views it used to share a file with:
 * that one answers "what did this person say", this one "what did everyone
 * say". They share only the option-label resolution, which lives in
 * `form-answers`.
 *
 * The bars, the cards, the picker, the expand control and the empty states are
 * the design system's. The pie, the word cloud and the expand overlay still
 * carry their pre-system class names and are still styled by
 * `assets/scss/_management-workspace.scss`. That is deliberate rather than
 * forgotten: neither a donut nor a weighted tag cloud has a primitive in the
 * design system, `ui/chart.ts` builds HTML strings while this renders Preact,
 * and giving them one means new component CSS — chart work, not Bootstrap
 * removal.
 *
 * The root still takes `.pk` safely: every element the base layer has an
 * opinion about — the controls, the ordered list, the links — is a
 * design-system component now, and base says nothing about the `<circle>`s
 * and `<span>`s the two legacy shapes are made of.
 */

import { useMemo, useEffect, useState } from "preact/hooks";
import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import { FilterSelect } from "../FilterSelect";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Panel, PanelBody } from "../../ui/Panel";
import { isRecord } from "./form-answers";
// `pk-answer-list` and the `pk-chart__*` rows are written here as class names
// rather than reached through a component — `ui/chart.ts` emits HTML strings
// and this renders Preact — so this module has to pull both stylesheets into
// its own chunk.
import "../../ui/Content.css";
import "../../ui/Chart.css";

type VisualizationKind = "bar" | "pie" | "wordcloud" | "list";
type VisualizationChoice = "auto" | VisualizationKind;

interface FieldStat {
  field: FormFieldDefinition;
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

function configuredVisualization(field: FormFieldDefinition): VisualizationKind | null {
  const validation = isRecord(field.validation) ? field.validation : null;
  const value = validation?.adminVisualization ?? validation?.visualization;
  return value === "bar" || value === "pie" || value === "wordcloud" || value === "list" ? value : null;
}

function autoVisualization(field: FormFieldDefinition, uniqueAnswers: number): VisualizationKind {
  const optionCount = Array.isArray(field.options) ? field.options.length : 0;
  if (field.fieldType === "boolean") return "pie";
  if (field.fieldType === "select") return optionCount > 5 ? "bar" : "pie";
  if (field.fieldType === "multi_select") return optionCount > 10 || uniqueAnswers > 8 ? "bar" : "pie";
  if (field.fieldType === "textarea") return "wordcloud";
  if (field.fieldType === "text" && uniqueAnswers > 10) return "wordcloud";
  return "list";
}

function mapServerStats(fields: FormFieldDefinition[], stats: ServerFieldStat[]): FieldStat[] {
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
 * The labelled bar breakdown, on the design system's chart rows.
 *
 * `bar-row`, `bar-lbl` and `bar-cnt` were never defined in any stylesheet, so
 * the layout the `<meter>`'s `flex: 1` assumed did not exist and the rows fell
 * back to plain block flow. `pk-chart__bar-row` and its parts are the same
 * three slots, defined, on tokens, in both themes.
 *
 * `<progress>` rather than `<meter>` because that is what the stylesheet
 * paints — and because this is a share of a whole, which is what a progress
 * element means. Each bar names itself, so the value is not carried by length
 * alone; the label used to be truncated with the full text only in a `title`,
 * which is unreachable by keyboard and on touch, so it wraps instead.
 */
function BarStat({ stat }: { stat: FieldStat }) {
  return (
    <div class="pk-chart__bars">
      {stat.entries.slice(0, 12).map((entry) => (
        <div class="pk-chart__bar-row" key={entry.label}>
          <span class="pk-chart__bar-label pk-break">{entry.label}</span>
          <progress
            class="pk-chart__bar"
            max={100}
            value={Math.max(4, entry.percent)}
            aria-label={`${entry.label}: ${String(entry.percent)}%`}
          >
            {entry.percent}%
          </progress>
          <span class="pk-chart__bar-count">{entry.count}</span>
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
  if (stat.visualization === "wordcloud") return <WordCloudStat stat={stat} />;
  return <ListStat stat={stat} />;
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
          options={[
            { value: "auto", label: `Auto (${visualizationLabel})` },
            { value: "bar", label: "Bar" },
            { value: "pie", label: "Pie" },
            { value: "wordcloud", label: "Word cloud" },
            { value: "list", label: "List" },
          ]}
          onChange={onChoiceChange}
        />
        {onExpand && (
          // The name says which chart it expands: a grid of these otherwise
          // offers a column of controls all called "Expand chart".
          <Button
            size="sm"
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
  fields: FormFieldDefinition[];
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
            {/* The close control names what it closes and carries a visible
                glyph, rather than being an empty Bootstrap `btn-close` whose
                only content was a background image. */}
            <Button
              class="adm-stat-modal-close"
              variant="ghost"
              icon
              aria-label={`Close ${expandedStat.field.label} chart`}
              onClick={() => setExpandedFieldKey(null)}
            >
              <span aria-hidden="true">×</span>
            </Button>
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
