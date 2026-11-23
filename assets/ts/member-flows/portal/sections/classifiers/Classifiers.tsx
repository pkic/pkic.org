/**
 * Automatic checks, PKIC-wide: for each kind of content, whether it is
 * checked, the context the model reads, the questions it answers, and a test
 * bench. Every event starts from these and adds its own.
 */
import { useState } from "preact/hooks";
import {
  CLASSIFIER_KIND_LABELS,
  CLASSIFIER_KINDS,
  type ClassifierKind,
  type ClassifierQuestion,
} from "../../../../../shared/classifiers";
import {
  classifierSavedResponseSchema,
  classifierSettingsListResponseSchema,
  type ClassifierSettingsInput,
  type ClassifierSettingsResponse,
} from "../../../../../shared/schemas/classifiers";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";
import { PageHeader } from "../../../../ui/PageHeader";
import { toast } from "../../ui";
import { ClassifierBasics } from "./ClassifierBasics";
import { ClassifierQuestions } from "./ClassifierQuestions";
import { ClassifierTrial } from "./ClassifierTrial";

const CLASSIFIERS_API = "/api/v1/classifiers";

function isKind(value: string | undefined): value is ClassifierKind {
  return CLASSIFIER_KINDS.includes(value as ClassifierKind);
}

function KindSettings({
  initial,
  canWrite,
  onSaved,
}: {
  initial: ClassifierSettingsResponse;
  canWrite: boolean;
  onSaved: (settings: ClassifierSettingsResponse) => void;
}) {
  const [settings, setSettings] = useState(initial);

  async function save(patch: Partial<Omit<ClassifierSettingsInput, "expectedRevision">>) {
    const body: ClassifierSettingsInput = {
      expectedRevision: settings.revision,
      enabled: settings.enabled,
      model: settings.model,
      context: settings.context,
      questions: settings.questions,
      ...patch,
    };
    const saved = await putJson(`${CLASSIFIERS_API}/${settings.kind}`, body, classifierSavedResponseSchema);
    const next = { ...settings, ...body, revision: saved.revision, saved: true };
    setSettings(next);
    onSaved(next);
    toast("Check saved", "success");
  }

  async function saveQuestion(question: ClassifierQuestion, replacing: string | null) {
    const questions = replacing
      ? settings.questions.map((candidate) => (candidate.id === replacing ? question : candidate))
      : [...settings.questions, question];
    await save({ questions });
  }

  async function removeQuestion(question: ClassifierQuestion) {
    const confirmed = await confirmAction({
      title: `Remove ${question.id}?`,
      body: "Events that changed or turned off this question keep their own version.",
      confirmLabel: "Remove question",
      tone: "danger",
    });
    if (confirmed) await save({ questions: settings.questions.filter((candidate) => candidate.id !== question.id) });
  }

  return (
    <>
      <ClassifierBasics key={settings.revision} settings={settings} canWrite={canWrite} onSave={save} />
      <ClassifierQuestions
        caption={`${CLASSIFIER_KIND_LABELS[settings.kind]} questions`}
        rows={settings.questions.map((question) => ({ question }))}
        canWrite={canWrite}
        onSave={saveQuestion}
        onRemove={(question) =>
          void removeQuestion(question).catch((error: unknown) => toast((error as Error).message, "error"))
        }
      />
      <ClassifierTrial kind={settings.kind} check={settings} trialUrl={`${CLASSIFIERS_API}/${settings.kind}/trials`} />
    </>
  );
}

export function Classifiers({ canWrite, kind: requested }: { canWrite: boolean; kind?: string }) {
  const state = useData(() => getJson(CLASSIFIERS_API, classifierSettingsListResponseSchema), []);
  const kind = isKind(requested) ? requested : "chat_message";
  // What was saved here, so a tab left and revisited starts from the saved settings and their revision.
  const [saved, setSaved] = useState<Partial<Record<ClassifierKind, ClassifierSettingsResponse>>>({});
  const settings = saved[kind] ?? state.data?.checks.find((check) => check.kind === kind);

  return (
    <div class="pk pk-stack">
      <PageHeader
        title="Automatic checks"
        description="A model reads chat messages, questions, proposals and slides, and advises or blocks what breaks the rules. Events add their own context and questions."
      />
      <Tabs
        label="Kinds of content"
        items={CLASSIFIER_KINDS.map((key) => ({ key, label: CLASSIFIER_KIND_LABELS[key] }))}
        active={kind}
        hrefFor={(key) => `/settings/automatic-checks/${key}`}
      />
      {state.loading && !state.data ? (
        <Spinner label="Loading the checks…" />
      ) : state.error ? (
        <ErrorAlert error={state.error} />
      ) : settings ? (
        <KindSettings
          key={kind}
          initial={settings}
          canWrite={canWrite}
          onSaved={(next) => setSaved((current) => ({ ...current, [next.kind]: next }))}
        />
      ) : null}
    </div>
  );
}
