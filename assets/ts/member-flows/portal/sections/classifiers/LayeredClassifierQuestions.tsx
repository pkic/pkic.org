/**
 * The questions of one scope beside those of the scope below it, in one list:
 * a kind's beside all content's, an event's beside the PKIC-wide ones. A
 * question from below can be turned off or changed for this scope only; a
 * changed one can go back to the version below.
 */
import type { ClassifierLayer, ClassifierQuestion } from "../../../../../shared/classifiers";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { toast } from "../../ui";
import { ClassifierQuestions } from "./ClassifierQuestions";
import type { ClassifierQuestionRow } from "./ClassifierQuestionTable";

export interface ClassifierLayerNames {
  /** The scope below, as the From column names it: "All content", "PKIC-wide". */
  below: string;
  /** This scope, as the From column names it: "Chat messages", "This event". */
  layer: string;
  /** This scope after "Change for": "chat messages", "this event". */
  changeFor: string;
}

type LayerPatch = Partial<Pick<ClassifierLayer, "questions" | "disabledQuestionIds">>;

/** Every question in one list: those from below first, each marked off or replaced, then this scope's own. */
export function layeredQuestionRows(
  below: readonly ClassifierQuestion[],
  layer: Pick<ClassifierLayer, "questions" | "disabledQuestionIds">,
  names: Pick<ClassifierLayerNames, "below" | "layer">,
): ClassifierQuestionRow[] {
  const disabled = new Set(layer.disabledQuestionIds);
  const own = new Map(layer.questions.map((question) => [question.id, question]));
  const rows: ClassifierQuestionRow[] = below.map((question) => {
    const replacement = own.get(question.id);
    return replacement
      ? { question: replacement, source: names.layer, off: disabled.has(question.id) }
      : { question, source: names.below, off: disabled.has(question.id) };
  });
  const inherited = new Set(below.map((question) => question.id));
  for (const question of layer.questions)
    if (!inherited.has(question.id)) rows.push({ question, source: names.layer, off: disabled.has(question.id) });
  return rows;
}

export function LayeredClassifierQuestions({
  caption,
  below,
  layer,
  names,
  removeBody,
  canWrite,
  onSave,
}: {
  caption: string;
  below: readonly ClassifierQuestion[];
  layer: Pick<ClassifierLayer, "questions" | "disabledQuestionIds">;
  names: ClassifierLayerNames;
  /** What removing one of this scope's own questions means beyond it, if anything. */
  removeBody?: string;
  canWrite: boolean;
  onSave: (patch: LayerPatch) => Promise<void>;
}) {
  const inherited = new Set(below.map((question) => question.id));
  const report = (error: unknown) => toast((error as Error).message, "error");

  async function saveQuestion(question: ClassifierQuestion, replacing: string | null) {
    const others = layer.questions.filter((candidate) => candidate.id !== (replacing ?? question.id));
    await onSave({ questions: [...others, question] });
  }

  async function removeQuestion(question: ClassifierQuestion) {
    const restores = inherited.has(question.id);
    const confirmed = await confirmAction({
      title: restores ? `Use the ${names.below} version of ${question.id}?` : `Remove ${question.id}?`,
      body: restores
        ? `The version for ${names.changeFor} goes, and the ${names.below} question applies again.`
        : removeBody,
      confirmLabel: restores ? `Use the ${names.below} version` : "Remove question",
      tone: "danger",
    });
    if (confirmed) await onSave({ questions: layer.questions.filter((candidate) => candidate.id !== question.id) });
  }

  function toggle(row: ClassifierQuestionRow) {
    const disabled = new Set(layer.disabledQuestionIds);
    if (row.off) disabled.delete(row.question.id);
    else disabled.add(row.question.id);
    void onSave({ disabledQuestionIds: [...disabled] }).catch(report);
  }

  return (
    <ClassifierQuestions
      caption={caption}
      rows={layeredQuestionRows(below, layer, names)}
      canWrite={canWrite}
      editLabel={(row) => (row.source === names.below ? `Change for ${names.changeFor}` : "Change")}
      removeLabel={(row) =>
        row.source === names.below ? null : inherited.has(row.question.id) ? `Use the ${names.below} version` : "Remove"
      }
      extraActions={(row) =>
        inherited.has(row.question.id)
          ? [{ id: "toggle", label: row.off ? "Turn on" : "Turn off", onSelect: () => toggle(row) }]
          : []
      }
      onSave={saveQuestion}
      onRemove={(question) => void removeQuestion(question).catch(report)}
    />
  );
}
