/**
 * The test bench of a classifier: paste a sample, run the saved
 * questions on it, and read what the model answered to each one, raised or
 * not, so thresholds can be tuned before real content meets them.
 */
import { useState } from "preact/hooks";
import {
  CLASSIFIER_OUTCOME_LABELS,
  classifierRaisesConcerns,
  type ClassifierKind,
  type EffectiveClassifier,
} from "../../../../../shared/classifiers";
import { formatNumber } from "../../../../../shared/format-number";
import {
  classifierTrialInputSchema,
  classifierTrialResponseSchema,
  type ClassifierTrialResponse,
} from "../../../../../shared/schemas/classifiers";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { AttentionMark } from "../../../../ui/AttentionList";
import { Button } from "../../../../ui/Button";
import { DataTable } from "../../../../ui/DataTable";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Textarea, TextInput } from "../../../../ui/TextControl";

/** Proposals, slides and bios are read with a title; chat and questions have none. */
const TITLED_KINDS: ReadonlySet<ClassifierKind> = new Set(["proposal", "presentation", "person"]);

const SAMPLE_LABELS: Record<ClassifierKind, string> = {
  chat: "Chat message",
  question: "Question",
  proposal: "Abstract",
  presentation: "Slide text",
  organization: "Member page",
  person: "Biography",
};

function answerResult(check: EffectiveClassifier, id: string, percent: number, trial: ClassifierTrialResponse) {
  const question = check.questions.find((candidate) => candidate.id === id);
  if (question?.kind === "score") return trial.verdict.scores.find((score) => score.id === id)?.level;
  const raised = trial.verdict.flags.find((flag) => flag.id === id);
  if (!raised) return undefined;
  return <AttentionMark>{raised.blocking ? "Blocks" : `Advises (${formatNumber(percent)}%)`}</AttentionMark>;
}

export function ClassifierTrial({
  kind,
  check,
  trialUrl,
}: {
  kind: ClassifierKind;
  check: EffectiveClassifier;
  trialUrl: string;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [trial, setTrial] = useState<ClassifierTrialResponse | null>(null);
  const titled = TITLED_KINDS.has(kind);
  const form = useContractForm(classifierTrialInputSchema, {
    text,
    title: titled ? title : "",
    model: check.model,
    context: check.context,
    questions: check.questions,
  });

  async function run(event: Event) {
    event.preventDefault();
    if (running) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setRunning(true);
    setError("");
    try {
      setTrial(await postJson(trialUrl, checked.data, classifierTrialResponseSchema));
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel aria-label="Try the classifier">
      <PanelHeader title="Try the classifier" />
      <PanelBody class="pk-stack">
        <p class="pk-small">Runs the saved classifier questions on a sample. Nothing is stored.</p>
        <form class="pk-stack" noValidate {...form.handlers} onSubmit={(event) => void run(event)}>
          {titled && (
            <Field {...form.of("title")} label={kind === "person" ? "Job title" : "Title"}>
              {(control) => (
                <TextInput
                  {...control}
                  name="title"
                  value={title}
                  onInput={(event) => setTitle(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
          <Field {...form.of("text")} label={SAMPLE_LABELS[kind]} required>
            {(control) => (
              <Textarea
                {...control}
                name="text"
                rows={titled ? 6 : 3}
                value={text}
                onInput={(event) => setText(event.currentTarget.value)}
              />
            )}
          </Field>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={running} disabled={running}>
              Run classifier
            </Button>
          </div>
          <ErrorAlert error={error} />
        </form>
        {trial?.verdict.outcome === "unchecked" && (
          <Alert tone="warn">The model did not answer. Try again in a moment.</Alert>
        )}
        {trial && trial.verdict.outcome !== "unchecked" && (
          <DescriptionList
            density="compact"
            items={[
              {
                term: "Result",
                value: classifierRaisesConcerns(trial.verdict.outcome) ? (
                  <AttentionMark>{CLASSIFIER_OUTCOME_LABELS[trial.verdict.outcome]}</AttentionMark>
                ) : (
                  CLASSIFIER_OUTCOME_LABELS[trial.verdict.outcome]
                ),
              },
              {
                term: "Score",
                value:
                  trial.verdict.scorePercent === null
                    ? undefined
                    : `${formatNumber(Math.round(trial.verdict.scorePercent))}%`,
              },
              { term: "Time", value: `${formatNumber(trial.latencyMs)} ms` },
            ]}
          />
        )}
      </PanelBody>
      {trial && trial.verdict.outcome !== "unchecked" && trial.answers.length > 0 && (
        <PanelBody flush>
          <DataTable
            caption="Answers"
            rows={trial.answers}
            rowKey={(answer) => answer.id}
            columns={[
              { id: "id", header: "Question", width: "primary", cellClass: "pk-mono", cell: (answer) => answer.id },
              {
                id: "percent",
                header: "Answer",
                width: "fit",
                align: "end",
                recordLabel: null,
                cell: (answer) => `${formatNumber(answer.percent)}%`,
              },
              {
                id: "result",
                header: "Result",
                width: "fit",
                cell: (answer) => answerResult(check, answer.id, answer.percent, trial),
              },
            ]}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
