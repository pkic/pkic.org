import { useState } from "preact/hooks";
import { liveQuestionRewriteSchema, type LiveQuestion } from "../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Textarea } from "../../../../../../ui/TextControl";

/**
 * Proposes clearer wording for a question. This is the seam for a writing
 * assistant: it only fills the editor, and the operator still reviews, edits
 * and sends the text through the same contract.
 */
export type LiveQuestionRewriteAssistant = (text: string) => Promise<string>;

/** Edits the text a question shows on the desk, to attendees and on air; the author's words stay on record. */
export function LiveQuestionRewrite({
  question,
  assistant,
  onSave,
  onClose,
}: {
  question: LiveQuestion;
  assistant?: LiveQuestionRewriteAssistant;
  onSave: (text: string) => boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState(question.text);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const form = useContractForm(liveQuestionRewriteSchema, { text });
  const original = question.originalText ?? question.text;

  function save() {
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    if (!onSave(checked.data.text)) return setError("The room is reconnecting. Please try again in a moment.");
    onClose();
  }

  async function suggest(propose: LiveQuestionRewriteAssistant) {
    setSuggesting(true);
    setError(null);
    try {
      setText(await propose(original));
    } catch {
      setError("No suggestion is available right now. Edit the text yourself.");
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <Dialog
      open
      title="Edit question text"
      description={`Asked as “${original}”. Attendees and the broadcast show your text; the original stays on record.`}
      confirmLabel="Save text"
      onConfirm={save}
      onCancel={onClose}
    >
      <form
        class="pk-stack pk-stack--snug"
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field label="Shown text" {...form.of("text")}>
          {(control) => (
            <Textarea
              {...control}
              name="text"
              rows={3}
              value={text}
              onInput={(event) => setText(event.currentTarget.value)}
            />
          )}
        </Field>
        {assistant ? (
          <div class="pk-cluster">
            <Button variant="secondary" loading={suggesting} onClick={() => void suggest(assistant)}>
              Suggest wording
            </Button>
          </div>
        ) : null}
        {error ? <p class="pk-live-questions__notice">{error}</p> : null}
      </form>
    </Dialog>
  );
}
