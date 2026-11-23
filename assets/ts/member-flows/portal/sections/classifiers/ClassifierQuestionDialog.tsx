/**
 * One question of an automatic check, added or changed in a dialog: a flag
 * that advises or blocks with a message to the author, or a score that rates
 * the content for reviewers on levels from lowest to highest.
 */
import { useState } from "preact/hooks";
import type { ClassifierQuestion } from "../../../../../shared/classifiers";
import { classifierQuestionSchema } from "../../../../../shared/schemas/classifiers";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { Dialog } from "../../../../ui/Dialog";
import { Field } from "../../../../ui/Field";
import { Textarea, TextInput } from "../../../../ui/TextControl";

export const BLANK_FLAG: ClassifierQuestion = {
  id: "",
  kind: "flag",
  question: "",
  adviseAtPercent: 50,
  blockAtPercent: null,
  message: "",
};

export const BLANK_SCORE: ClassifierQuestion = {
  id: "",
  kind: "score",
  label: "",
  question: "",
  levels: [],
  weight: 1,
};

/** A typed number, or what the contract refuses when the field is blank. */
function numberOrBlank(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function ClassifierQuestionDialog({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: ClassifierQuestion;
  isNew: boolean;
  onSave: (question: ClassifierQuestion) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [levels, setLevels] = useState(initial.kind === "score" ? initial.levels.join("\n") : "");
  const [adviseText, setAdviseText] = useState(initial.kind === "flag" ? String(initial.adviseAtPercent) : "");
  const [blockText, setBlockText] = useState(
    initial.kind === "flag" && initial.blockAtPercent !== null ? String(initial.blockAtPercent) : "",
  );
  const [weightText, setWeightText] = useState(initial.kind === "score" ? String(initial.weight) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The typed text stays as typed; it becomes a number only for the contract.
  const body =
    draft.kind === "score"
      ? {
          ...draft,
          weight: Number(weightText),
          levels: levels
            .split("\n")
            .map((level) => level.trim())
            .filter(Boolean),
        }
      : { ...draft, adviseAtPercent: Number(adviseText), blockAtPercent: numberOrBlank(blockText) };
  const form = useContractForm(classifierQuestionSchema, body);
  const set = (patch: Partial<ClassifierQuestion>) => setDraft({ ...draft, ...patch } as ClassifierQuestion);

  async function save() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(checked.data);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  const flag = draft.kind === "flag";
  return (
    <div class="pk">
      <Dialog
        open
        title={isNew ? (flag ? "Add a flag" : "Add a score") : flag ? "Change flag" : "Change score"}
        description={
          flag
            ? "A yes or no question: yes means something is wrong. The author sees the message when it is raised."
            : "Rates the content for reviewers. It never stops anyone."
        }
        confirmLabel={isNew ? "Add" : "Save"}
        confirmDisabled={saving}
        onConfirm={() => void save()}
        onCancel={onCancel}
      >
        <form
          class="pk-stack"
          noValidate
          {...form.handlers}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field
            {...form.of("id")}
            label="Id"
            required
            help={
              isNew
                ? "Lowercase letters, digits and underscores. An event uses it to replace or turn off the question."
                : undefined
            }
          >
            {(control) => (
              <TextInput
                {...control}
                name="id"
                class="pk-mono"
                value={draft.id}
                readOnly={!isNew}
                onInput={(event) => set({ id: event.currentTarget.value })}
              />
            )}
          </Field>
          {draft.kind === "score" && (
            <Field {...form.of("label")} label="Name" required help="What reviewers see beside the level.">
              {(control) => (
                <TextInput
                  {...control}
                  name="label"
                  value={draft.label}
                  onInput={(event) => set({ label: event.currentTarget.value })}
                />
              )}
            </Field>
          )}
          <Field {...form.of("question")} label="Question" required>
            {(control) => (
              <Textarea
                {...control}
                name="question"
                rows={4}
                value={draft.question}
                onInput={(event) => set({ question: event.currentTarget.value })}
              />
            )}
          </Field>
          {draft.kind === "flag" ? (
            <>
              <div class="pk-grid pk-grid--tight">
                <Field {...form.of("adviseAtPercent")} label="Advise at (%)" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="adviseAtPercent"
                      type="number"
                      min={1}
                      max={100}
                      value={adviseText}
                      onInput={(event) => setAdviseText(event.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field {...form.of("blockAtPercent")} label="Block at (%)" help="Leave empty to only advise.">
                  {(control) => (
                    <TextInput
                      {...control}
                      name="blockAtPercent"
                      type="number"
                      min={1}
                      max={100}
                      value={blockText}
                      onInput={(event) => setBlockText(event.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <Field {...form.of("message")} label="Message to the author" required>
                {(control) => (
                  <Textarea
                    {...control}
                    name="message"
                    rows={2}
                    value={draft.message}
                    onInput={(event) => set({ message: event.currentTarget.value })}
                  />
                )}
              </Field>
            </>
          ) : (
            <>
              <Field {...form.of("levels")} label="Levels" required help="One per line, lowest first.">
                {(control) => (
                  <Textarea
                    {...control}
                    name="levels"
                    rows={5}
                    value={levels}
                    onInput={(event) => setLevels(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field {...form.of("weight")} label="Weight" required help="How much the score counts in the total.">
                {(control) => (
                  <TextInput
                    {...control}
                    name="weight"
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={weightText}
                    onInput={(event) => setWeightText(event.currentTarget.value)}
                  />
                )}
              </Field>
            </>
          )}
          <ErrorAlert error={error} />
        </form>
      </Dialog>
    </div>
  );
}
