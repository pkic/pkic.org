/**
 * The questions of a classifier, one row each: what it asks, whether it
 * is a flag or a score, and from what certainty a flag advises or blocks.
 */
import type { ComponentChildren } from "preact";
import type { ClassifierQuestion } from "../../../../../shared/classifiers";
import { DataTable } from "../../../../ui/DataTable";
import { Menu, type MenuItem } from "../../../../ui/Menu";

export interface ClassifierQuestionRow {
  question: ClassifierQuestion;
  /** Where the question comes from, when an event's list mixes them. */
  source?: string;
  /** Kept in the list, but not asked. */
  off?: boolean;
}

function percent(value: number | null): string {
  return value === null ? "Never" : `${String(value)}%`;
}

export function ClassifierQuestionTable({
  caption,
  rows,
  actionsFor,
  empty,
}: {
  caption: string;
  rows: readonly ClassifierQuestionRow[];
  actionsFor?: (row: ClassifierQuestionRow) => MenuItem[];
  empty: ComponentChildren;
}) {
  const hasSource = rows.some((row) => row.source);
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(row) => `${row.source ?? ""}:${row.question.id}`}
      empty={empty}
      columns={[
        {
          id: "question",
          header: "Question",
          width: "primary",
          cell: ({ question, off }) => {
            const text = question.kind === "score" ? question.label : question.question;
            return (
              <>
                <span class={off ? "pk-table__wrap pk-muted" : "pk-table__wrap"} title={text}>
                  {text}
                </span>
                <span class="pk-small pk-muted pk-mono">{question.id}</span>
              </>
            );
          },
        },
        ...(hasSource
          ? [
              {
                id: "source",
                header: "From",
                width: "fit" as const,
                cell: (row: ClassifierQuestionRow) => (row.off ? `${row.source ?? ""}, turned off` : row.source),
              },
            ]
          : []),
        {
          id: "kind",
          header: "Type",
          width: "fit",
          cell: ({ question }) => (question.kind === "flag" ? "Flag" : "Score"),
        },
        {
          id: "advise",
          header: "Advises at",
          width: "fit",
          align: "end",
          recordLabel: "advises",
          cell: ({ question }) => (question.kind === "flag" ? percent(question.adviseAtPercent) : undefined),
        },
        {
          id: "block",
          header: "Blocks at",
          width: "fit",
          align: "end",
          recordLabel: "blocks",
          cell: ({ question }) => (question.kind === "flag" ? percent(question.blockAtPercent) : undefined),
        },
        ...(actionsFor
          ? [
              {
                id: "actions",
                header: "Actions",
                headerHidden: true,
                width: "fit" as const,
                cell: (row: ClassifierQuestionRow) => {
                  const items = actionsFor(row);
                  return items.length ? (
                    <Menu label={`Actions for ${row.question.id}`} align="end" items={items} />
                  ) : undefined;
                },
              },
            ]
          : []),
      ]}
    />
  );
}
