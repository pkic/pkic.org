import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { LIVE_POLL_POLICY } from "../../../../../../../shared/live-session-policy";
import type { FormFieldType } from "../../../../../../../shared/schemas/forms";
import {
  livePollDraftSchema,
  livePollLiveEdit,
  type LivePoll,
  type LivePollDraft,
} from "../../../../../../../shared/schemas/live-session-poll";
import { formFieldAnswerChoices } from "../../../../../../../shared/form-field-statistics";
import { parseFormFieldOptions } from "../../../../../../../shared/schemas/form-field-rules";
import { formatNumber } from "../../../../../../../shared/format-number";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { FormChoicesEditor } from "../../../../../../components/forms/FormChoicesEditor";
import { QuestionBasics } from "../../../../../../components/forms/FormQuestionCard";
import {
  emptyFieldDraft,
  fieldDraftToInput,
  fieldToDraft,
  type FieldDraft,
} from "../../../../../../components/forms/form-field-draft";
import { useFormTabs } from "../../../../../../hooks/useFormTabs";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { TabList } from "../../../../../../ui/TabList";
import { Checkbox, Radio } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import "../../../../../../components/forms/FormBuilder.css";

/** What an operator calls the answer types a poll can count. */
const POLL_TYPE_LABELS: Record<string, string> = {
  select: "Single choice",
  multi_select: "Multiple choice",
  number: "Rating",
  text: "Short answer / word cloud",
  textarea: "Written answer / word cloud",
};

/** The respondent control each poll type starts with: every choice visible at once, a rating as scores. */
const STARTING_WIDGET: Record<string, string> = {
  select: "radios",
  multi_select: "checkboxes",
  number: "rating_stars",
  text: "",
  textarea: "",
};

/** Local starting points create ordinary drafts for the selected session, never event-wide polls. */
const POLL_STARTERS: readonly { label: string; question: string; patch: Partial<FieldDraft> }[] = [
  {
    label: "Yes / no",
    question: "Do you agree?",
    patch: { fieldType: "select", uiWidget: "radios", optionsText: "Yes\nNo" },
  },
  {
    label: "Yes / no / unsure",
    question: "Do you agree?",
    patch: { fieldType: "select", uiWidget: "radios", optionsText: "Yes\nNo\nUnsure" },
  },
  {
    label: "Rating 1–5",
    question: "How would you rate this?",
    patch: { fieldType: "number", uiWidget: "rating_stars", min: "1", max: "5", step: "1" },
  },
  {
    label: "NPS 0–10",
    question: "How likely are you to recommend this?",
    patch: { fieldType: "number", uiWidget: "nps", min: "0", max: "10", step: "1" },
  },
];

function startingDraft(poll?: LivePoll): FieldDraft {
  if (poll)
    return {
      ...fieldToDraft({
        ...poll.field,
        options: poll.field.options ?? null,
        optionSource: null,
        validation: poll.field.validation ?? null,
      }),
      // The author edits each choice's words; its stored value stays with it.
      optionsText: parseFormFieldOptions(poll.field.options)
        .map((option) => option.label)
        .join("\n"),
    };
  return { ...emptyFieldDraft(0, "select"), key: "answer", required: true, uiWidget: "radios", optionsText: "\n" };
}

/**
 * The poll's choices with the value each keeps: a choice that was already
 * offered keeps its stored value whatever its new words, so its answers stay
 * with it; a new choice takes its words as its value.
 */
function choicesWithValues(field: FieldDraft, values: readonly (string | null)[]) {
  const taken = new Set(values.filter((value): value is string => value !== null));
  return field.optionsText.split(/\n/).flatMap((line, at) => {
    const label = line.trim();
    if (!label) return [];
    let value = values[at] ?? label;
    if (values[at] == null) {
      for (let copy = 2; taken.has(value); copy++) value = `${label} (${copy})`;
      taken.add(value);
    }
    return [{ value, label, active: true }];
  });
}

/** How many answers the removed choices hold now. */
function answersLost(poll: LivePoll, removedValues: readonly string[]): number {
  const labels = new Map(formFieldAnswerChoices(poll.field).map((choice) => [choice.value, choice.label]));
  const counts = new Map((poll.results?.entries ?? []).map((entry) => [entry.label, entry.count]));
  return removedValues.reduce((sum, value) => sum + (counts.get(labels.get(value) ?? value) ?? 0), 0);
}

/** What a poll editor gives the dialog it sits in: its form, and the save its confirm runs. */
export interface LivePollEditorView {
  body: ComponentChildren;
  /** Validates and sends the poll, at once or after a confirmation; `onSaved` follows a save that went through. */
  save: () => void;
  /** What the editor can and cannot change, for the dialog's description. */
  description: string;
}

/**
 * Prepares a poll, or corrects one at any time. The question is written with
 * the forms question editor and passes the poll contract — the forms field
 * contract, narrowed to answers the room can count — before it is sent. Once
 * people may have answered, the answer type and scale stay fixed, wording
 * and choices can change, and removing a choice that holds answers asks first.
 */
export function useLivePollEditor({
  poll,
  onSave,
  onSaved,
}: {
  /** The draft being changed; absent for a new poll. */
  poll?: LivePoll;
  onSave: (draft: LivePollDraft, discardRemovedAnswers: boolean) => boolean;
  /** Runs once the room took the poll, whether saved from the dialog's confirm or the form's Enter. */
  onSaved: () => void;
}): LivePollEditorView {
  const live = poll !== undefined && poll.status !== "draft";
  const [field, setField] = useState<FieldDraft>(() => startingDraft(poll));
  const [values, setValues] = useState<(string | null)[]>(() =>
    parseFormFieldOptions(poll?.field.options).map((option) => option.value),
  );
  const [showResults, setShowResults] = useState(poll?.showResults ?? true);
  const [error, setError] = useState<string | null>(null);
  const input = fieldDraftToInput(field, 0);
  const choice = field.fieldType === "select" || field.fieldType === "multi_select";
  const choices = choice ? choicesWithValues(field, values) : [];
  const form = useContractForm(livePollDraftSchema, {
    field: choice ? { ...input, options: choices.length ? choices : undefined } : input,
    showResults,
  });
  const tabs = useFormTabs(form, [
    {
      id: "question",
      label: "Question",
      fields: [
        "field.label",
        "field.fieldType",
        "field.options",
        "field.validation.min",
        "field.validation.max",
        "showResults",
      ],
    },
    {
      id: "details",
      label: "Details",
      fields: [
        "field.validation.helpText",
        "field.validation.uiWidget",
        "field.validation.minItems",
        "field.validation.maxItems",
      ],
    },
  ]);
  // The question's parts, as the poll contract judges them, on the question editor's own controls.
  const presentationOf = (path: string) => form.ofGroup(`field.${path}`);

  function update(patch: Partial<FieldDraft>) {
    setField((current) => {
      const next = { ...current, ...patch };
      // A new type starts on its own respondent control, so a rating is not left a bare number box.
      if (patch.fieldType && patch.fieldType !== current.fieldType)
        next.uiWidget = STARTING_WIDGET[patch.fieldType] ?? "";
      if (patch.fieldType === "number") {
        next.min ||= "1";
        next.max ||= "5";
        next.step ||= "1";
      }
      return next;
    });
    // A choice added at the end has no stored value yet.
    if (patch.optionsText !== undefined) {
      const lines = patch.optionsText.split(/\n/).length;
      setValues((current) =>
        lines > current.length ? [...current, ...Array<null>(lines - current.length).fill(null)] : current,
      );
    }
  }

  /** Sends the checked poll; true once the room took it. */
  function send(draft: LivePollDraft, discard: boolean): boolean {
    if (onSave(draft, discard)) {
      onSaved();
      return true;
    }
    setError("The room is reconnecting. Please try again in a moment.");
    return false;
  }

  /** Saves at once, or after asking when the change would delete answers. */
  function save(): void {
    void check();
  }

  function check(): boolean | Promise<boolean> {
    const checked = form.submit();
    if (!checked.data) {
      tabs.revealErrors();
      setError(checked.formMessage);
      return false;
    }
    if (live) {
      const edit = livePollLiveEdit(poll.field, checked.data.field);
      if (edit.problem) {
        setError(edit.problem);
        return false;
      }
      const lost = answersLost(poll, edit.removedValues);
      if (lost > 0) {
        const removed = edit.removedValues.length;
        const draft = checked.data;
        return confirmAction({
          title:
            removed === 1
              ? "Remove a choice that has answers?"
              : `Remove ${formatNumber(removed)} choices that have answers?`,
          body: `${formatNumber(lost)} ${lost === 1 ? "answer is" : "answers are"} deleted with ${removed === 1 ? "it" : "them"}. Everyone else keeps their answer.`,
          confirmLabel: "Remove and save",
          tone: "danger",
        }).then((confirmed) => confirmed && send(draft, true));
      }
    }
    return send(checked.data, false);
  }

  const description = live
    ? "People may have answered this poll. Correct the question and choices; each answer stays with its choice. The answer type and scale can't change."
    : "Prepare polls for the selected session before it starts. Saving keeps a draft; open voting when attendees should answer.";
  const body = (
    <form
      class="pk-stack pk-stack--snug"
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <TabList label="Poll sections" {...tabs.list} />
      <div class="pk-stack pk-stack--snug" {...tabs.panel("question")}>
        {live ? null : (
          <Field
            label="Start with"
            group
            help="These starting points fill choices or rating scores. Your question stays as written."
          >
            {() => (
              <div class="pk-cluster">
                {POLL_STARTERS.map((starter) => (
                  <Button
                    key={starter.label}
                    onClick={() => {
                      setField((current) => ({
                        ...current,
                        ...starter.patch,
                        label: current.label.trim() ? current.label : starter.question,
                      }));
                      setValues([]);
                      setError(null);
                    }}
                  >
                    {starter.label}
                  </Button>
                ))}
              </div>
            )}
          </Field>
        )}
        <QuestionBasics
          field={field}
          update={update}
          types={live ? [poll.field.fieldType] : (LIVE_POLL_POLICY.fieldTypes as readonly FormFieldType[])}
          typeLabel={(type) => POLL_TYPE_LABELS[type] ?? type}
          answerTypeControl="radio"
          presentationOf={presentationOf}
        />
        {field.fieldType === "number" ? (
          <div class="pk-formq__split">
            {(["min", "max"] as const).map((bound) => (
              <Field
                key={bound}
                label={bound === "min" ? "Lowest score" : "Highest score"}
                {...presentationOf(`validation.${bound}`)}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    type="number"
                    step="1"
                    name={bound}
                    disabled={live}
                    value={field[bound]}
                    onInput={(event) => update({ [bound]: event.currentTarget.value })}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : field.fieldType === "select" || field.fieldType === "multi_select" ? (
          <FormChoicesEditor
            field={field}
            update={update}
            presentation={presentationOf("options")}
            onRemove={(at) => setValues((current) => current.filter((_, index) => index !== at))}
          />
        ) : null}
        <Checkbox
          name="showResults"
          checked={showResults}
          onChange={(event) => setShowResults(event.currentTarget.checked)}
          label="Show results to attendees"
          hint="Attendees see the results after they answer and once the poll closes."
        />
      </div>
      <div class="pk-stack pk-stack--snug" {...tabs.panel("details")}>
        <Field label="Description" {...presentationOf("validation.helpText")}>
          {(control) => (
            <TextInput
              {...control}
              name="helpText"
              value={field.helpText}
              onInput={(event) => update({ helpText: event.currentTarget.value })}
            />
          )}
        </Field>
        {field.fieldType === "number" ? (
          <Field label="Rating display" group {...presentationOf("validation.uiWidget")}>
            {(control) => (
              <div class="pk-cluster">
                <Radio
                  name={control.id}
                  label="Stars"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                  checked={field.uiWidget === "rating_stars"}
                  disabled={live}
                  onChange={() => update({ uiWidget: "rating_stars" })}
                />
                <Radio
                  name={control.id}
                  label="Numbered scores"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                  checked={field.uiWidget === "nps"}
                  disabled={live}
                  onChange={() => update({ uiWidget: "nps" })}
                />
              </div>
            )}
          </Field>
        ) : field.fieldType === "multi_select" ? (
          <div class="pk-formq__split">
            {(["minItems", "maxItems"] as const).map((bound) => (
              <Field
                key={bound}
                label={bound === "minItems" ? "Minimum selections" : "Maximum selections"}
                {...presentationOf(`validation.${bound}`)}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name={bound}
                    type="number"
                    min="0"
                    step="1"
                    disabled={live}
                    value={field[bound]}
                    onInput={(event) => update({ [bound]: event.currentTarget.value })}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
  return { body, save, description };
}

/** A poll in its own dialog: a new one from the panel's create action, or one to correct. */
export function LivePollEditor({
  poll,
  onSave,
  onClose,
}: {
  poll?: LivePoll;
  onSave: (draft: LivePollDraft, discardRemovedAnswers: boolean) => boolean;
  onClose: () => void;
}) {
  const editor = useLivePollEditor({ poll, onSave, onSaved: onClose });
  return (
    <Dialog
      open
      size="wide"
      title={poll ? "Edit poll" : "New poll"}
      description={editor.description}
      confirmLabel={poll ? "Save poll" : "Add poll"}
      onConfirm={editor.save}
      onCancel={onClose}
    >
      {editor.body}
    </Dialog>
  );
}
