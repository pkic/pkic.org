/**
 * The questions panel of a classifier: the list, adding a flag or a
 * score from the panel's menu, and changing or removing one from its row.
 */
import { useState } from "preact/hooks";
import type { ClassifierQuestion } from "../../../../../shared/classifiers";
import { EmptyState } from "../../../../ui/EmptyState";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { BLANK_FLAG, BLANK_SCORE, ClassifierQuestionDialog } from "./ClassifierQuestionDialog";
import { ClassifierQuestionTable, type ClassifierQuestionRow } from "./ClassifierQuestionTable";

interface Editing {
  question: ClassifierQuestion;
  /** The id the question had, or null for a new one. */
  replacing: string | null;
}

export function ClassifierQuestions({
  title = "Classifier questions",
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
  rows: readonly ClassifierQuestionRow[];
  canWrite: boolean;
  editLabel?: (row: ClassifierQuestionRow) => string;
  /** Null when the row cannot be removed here. */
  removeLabel?: (row: ClassifierQuestionRow) => string | null;
  extraActions?: (row: ClassifierQuestionRow) => MenuItem[];
  onSave: (question: ClassifierQuestion, replacing: string | null) => Promise<void>;
  onRemove: (question: ClassifierQuestion) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);

  const actionsFor = (row: ClassifierQuestionRow): MenuItem[] => {
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
            label="Classifier question actions"
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
      <PanelBody flush>
        <ClassifierQuestionTable
          caption={caption}
          rows={rows}
          actionsFor={canWrite ? actionsFor : undefined}
          empty={
            <EmptyState
              title="No classifier questions yet."
              body={canWrite ? "Use the menu to add a flag or a score." : undefined}
            />
          }
        />
      </PanelBody>
      {editing && (
        <ClassifierQuestionDialog
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
