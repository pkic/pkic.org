/**
 * The questions panel of an automatic check: the list, adding a flag or a
 * score from the panel's menu, and changing or removing one from its row.
 */
import { useState } from "preact/hooks";
import type { ContentCheckQuestion } from "../../../../../shared/content-checks";
import { EmptyState } from "../../../../ui/EmptyState";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { BLANK_FLAG, BLANK_SCORE, ContentCheckQuestionDialog } from "./ContentCheckQuestionDialog";
import { ContentCheckQuestionTable, type ContentCheckQuestionRow } from "./ContentCheckQuestionTable";

interface Editing {
  question: ContentCheckQuestion;
  /** The id the question had, or null for a new one. */
  replacing: string | null;
}

export function ContentCheckQuestions({
  title = "Questions",
  caption,
  rows,
  canWrite,
  editLabel = (row) => (row.question.kind === "flag" ? "Change flag" : "Change score"),
  removeLabel = () => "Remove",
  extraActions,
  onSave,
  onRemove,
}: {
  title?: string;
  caption: string;
  rows: readonly ContentCheckQuestionRow[];
  canWrite: boolean;
  editLabel?: (row: ContentCheckQuestionRow) => string;
  /** Null when the row cannot be removed here. */
  removeLabel?: (row: ContentCheckQuestionRow) => string | null;
  extraActions?: (row: ContentCheckQuestionRow) => MenuItem[];
  onSave: (question: ContentCheckQuestion, replacing: string | null) => Promise<void>;
  onRemove: (question: ContentCheckQuestion) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);

  const actionsFor = (row: ContentCheckQuestionRow): MenuItem[] => {
    const remove = removeLabel(row);
    return [
      {
        id: "edit",
        label: editLabel(row),
        onSelect: () => setEditing({ question: row.question, replacing: row.question.id }),
      },
      ...(extraActions?.(row) ?? []),
      ...(remove ? [{ id: "remove", label: remove, danger: true, onSelect: () => onRemove(row.question) }] : []),
    ];
  };

  return (
    <Panel aria-label={title}>
      <PanelHeader title={title}>
        {canWrite && (
          <Menu
            label="Question actions"
            align="end"
            items={[
              {
                id: "flag",
                label: "Add a flag",
                onSelect: () => setEditing({ question: BLANK_FLAG, replacing: null }),
              },
              {
                id: "score",
                label: "Add a score",
                onSelect: () => setEditing({ question: BLANK_SCORE, replacing: null }),
              },
            ]}
          />
        )}
      </PanelHeader>
      <PanelBody>
        <ContentCheckQuestionTable
          caption={caption}
          rows={rows}
          actionsFor={canWrite ? actionsFor : undefined}
          empty={
            <EmptyState
              title="No questions yet."
              body={canWrite ? "Use the menu to add a flag or a score." : undefined}
            />
          }
        />
      </PanelBody>
      {editing && (
        <ContentCheckQuestionDialog
          initial={editing.question}
          isNew={editing.replacing === null}
          onCancel={() => setEditing(null)}
          onSave={async (question) => {
            await onSave(question, editing.replacing);
            setEditing(null);
          }}
        />
      )}
    </Panel>
  );
}
