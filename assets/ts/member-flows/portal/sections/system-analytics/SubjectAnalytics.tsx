/**
 * The shape every subject's analytics page takes.
 *
 * #39 asked for the one system-wide analytics panel inside Settings to be
 * replaced by a page under each domain it measures — members, organizations,
 * users, events, donations. Five pages that each answer "how many, of what
 * kind, and how did that move" want one arrangement, not five: the headline
 * figures across the top, a split of the whole into its parts, and the twelve
 * months behind the reader.
 *
 * So this is the arrangement, and each domain supplies its own figures. The
 * alternative — a file per domain — is three copies of the same page differing
 * only in nouns, which the duplication gate would refuse and a reader would
 * have to check for agreement every time one of them changed.
 */
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { DataTable, type Column } from "../../../../components/Table";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
import { statusBars, svgBarChart } from "../../../../ui/chart";
import { EmptyState } from "../../../../components/EmptyState";

export interface SubjectFigure {
  label: string;
  value: number;
  note?: string;
}

/** A whole split into named parts — statuses, roles, kinds. */
export interface SubjectSplit {
  title: string;
  counts: Record<string, number>;
}

export interface SubjectSeries {
  title: string;
  /** Y-M keys as the read model returns them, drawn in order. */
  points: ReadonlyArray<{ month: string; count: number }>;
  valueHeader: string;
}

export interface SubjectTable<Row> {
  title: string;
  rows: Row[];
  columns: Column<Row>[];
  empty: string;
}

export function SubjectAnalytics<Row>({
  title,
  lede,
  loading,
  error,
  figures,
  splits,
  series,
  table,
}: {
  title: string;
  lede: string;
  loading: boolean;
  error: string | Error | null;
  figures: readonly SubjectFigure[];
  splits: readonly SubjectSplit[];
  series: SubjectSeries | null;
  table?: SubjectTable<Row>;
}) {
  if (loading) return <Spinner label={`Loading ${title.toLowerCase()}…`} />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div class="pk pk-stack">
      <PageHeader title={title} description={lede} />

      <div class="pk-stat-row">
        {figures.map((figure) => (
          <StatCard key={figure.label} label={figure.label} value={String(figure.value)} note={figure.note} />
        ))}
      </div>

      <div class="pk-grid pk-grid--roomy">
        {splits.map((split) => {
          const total = Object.values(split.counts).reduce((sum, count) => sum + count, 0);
          return (
            <Panel key={split.title}>
              <PanelHeader title={split.title} />
              <PanelBody>
                {/* The chart helpers return markup because they are shared with
                    surfaces that have no Preact on them; the same reason the
                    other analytics pages render them this way. */}
                <div dangerouslySetInnerHTML={{ __html: statusBars(split.counts, total) }} />
              </PanelBody>
            </Panel>
          );
        })}
      </div>

      {series && (
        <Panel>
          <PanelHeader title={series.title} />
          <PanelBody>
            <div
              dangerouslySetInnerHTML={{
                __html: svgBarChart(
                  series.points.map((point) => point.month),
                  series.points.map((point) => point.count),
                  { caption: series.title, valueHeader: series.valueHeader },
                ),
              }}
            />
          </PanelBody>
        </Panel>
      )}

      {table && (
        <Panel>
          <PanelHeader title={table.title} />
          <DataTable
            caption={table.title}
            columns={table.columns}
            data={table.rows}
            empty={<EmptyState title={table.empty} />}
          />
        </Panel>
      )}
    </div>
  );
}
