/**
 * Automatic checks, PKIC-wide: for each kind of content, whether it is
 * checked, the context the model reads, the questions it answers, and a test
 * bench. Every event starts from these and adds its own.
 */
import { useState } from "preact/hooks";
import {
  CONTENT_CHECK_KIND_LABELS,
  CONTENT_CHECK_KINDS,
  type ContentCheckKind,
  type ContentCheckQuestion,
} from "../../../../../shared/content-checks";
import {
  contentCheckSavedResponseSchema,
  contentCheckSettingsListResponseSchema,
  type ContentCheckSettingsInput,
  type ContentCheckSettingsResponse,
} from "../../../../../shared/schemas/content-checks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";
import { PageHeader } from "../../../../ui/PageHeader";
import { toast } from "../../ui";
import { ContentCheckBasics } from "./ContentCheckBasics";
import { ContentCheckQuestions } from "./ContentCheckQuestions";
import { ContentCheckTrial } from "./ContentCheckTrial";

const CONTENT_CHECKS_API = "/api/v1/content-checks";

function isKind(value: string | undefined): value is ContentCheckKind {
  return CONTENT_CHECK_KINDS.includes(value as ContentCheckKind);
}

function KindSettings({ initial, canWrite }: { initial: ContentCheckSettingsResponse; canWrite: boolean }) {
  const [settings, setSettings] = useState(initial);

  async function save(patch: Partial<Omit<ContentCheckSettingsInput, "expectedRevision">>) {
    const body: ContentCheckSettingsInput = {
      expectedRevision: settings.revision,
      enabled: settings.enabled,
      model: settings.model,
      context: settings.context,
      questions: settings.questions,
      ...patch,
    };
    const saved = await putJson(`${CONTENT_CHECKS_API}/${settings.kind}`, body, contentCheckSavedResponseSchema);
    setSettings({ ...settings, ...body, revision: saved.revision, saved: true });
    toast("Check saved", "success");
  }

  async function saveQuestion(question: ContentCheckQuestion, replacing: string | null) {
    const questions = replacing
      ? settings.questions.map((candidate) => (candidate.id === replacing ? question : candidate))
      : [...settings.questions, question];
    await save({ questions });
  }

  async function removeQuestion(question: ContentCheckQuestion) {
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
      <ContentCheckBasics key={settings.revision} settings={settings} canWrite={canWrite} onSave={save} />
      <ContentCheckQuestions
        caption={`${CONTENT_CHECK_KIND_LABELS[settings.kind]} questions`}
        rows={settings.questions.map((question) => ({ question }))}
        canWrite={canWrite}
        onSave={saveQuestion}
        onRemove={(question) =>
          void removeQuestion(question).catch((error: unknown) => toast((error as Error).message, "error"))
        }
      />
      <ContentCheckTrial
        kind={settings.kind}
        check={settings}
        trialUrl={`${CONTENT_CHECKS_API}/${settings.kind}/trials`}
      />
    </>
  );
}

export function ContentChecks({ canWrite, kind: requested }: { canWrite: boolean; kind?: string }) {
  const state = useData(() => getJson(CONTENT_CHECKS_API, contentCheckSettingsListResponseSchema), []);
  const kind = isKind(requested) ? requested : "chat_message";
  const settings = state.data?.checks.find((check) => check.kind === kind);

  return (
    <div class="pk pk-stack">
      <PageHeader
        title="Automatic checks"
        description="A model reads chat messages, questions, proposals and slides, and advises or blocks what breaks the rules. Events add their own context and questions."
      />
      <Tabs
        label="Kinds of content"
        items={CONTENT_CHECK_KINDS.map((key) => ({ key, label: CONTENT_CHECK_KIND_LABELS[key] }))}
        active={kind}
        hrefFor={(key) => `/settings/automatic-checks/${key}`}
      />
      {state.loading && !state.data ? (
        <Spinner label="Loading the checks…" />
      ) : state.error ? (
        <ErrorAlert error={state.error} />
      ) : settings ? (
        <KindSettings key={kind} initial={settings} canWrite={canWrite} />
      ) : null}
    </div>
  );
}
