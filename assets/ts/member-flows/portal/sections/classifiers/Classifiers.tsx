/**
 * Classifiers, PKIC-wide. All content holds the context and flags every kind
 * reads first. Each kind then says whether it is checked, on which model, what
 * it adds to the context, and which questions it adds, changes or turns off,
 * with a test bench. Every event starts from these and adds its own.
 */
import { useState } from "preact/hooks";
import {
  CLASSIFIER_KIND_LABELS,
  CLASSIFIER_KINDS,
  CLASSIFIER_SHARED_LABEL,
  CLASSIFIER_SHARED_SCOPE,
  wideClassifier,
  type ClassifierKind,
  type ClassifierQuestion,
} from "../../../../../shared/classifiers";
import {
  classifierSavedResponseSchema,
  classifierSettingsListResponseSchema,
  classifierSharedSettingsInputSchema,
  type ClassifierSettingsInput,
  type ClassifierSettingsResponse,
  type ClassifierSharedSettingsInput,
  type ClassifierSharedSettingsResponse,
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
import { ClassifierContext } from "./ClassifierContext";
import { ClassifierQuestions } from "./ClassifierQuestions";
import { ClassifierTrial } from "./ClassifierTrial";
import { LayeredClassifierQuestions } from "./LayeredClassifierQuestions";

const CLASSIFIERS_API = "/api/v1/classifiers";
type Scope = ClassifierKind | typeof CLASSIFIER_SHARED_SCOPE;
const SCOPES: readonly Scope[] = [CLASSIFIER_SHARED_SCOPE, ...CLASSIFIER_KINDS];
const SCOPE_LABELS: Record<Scope, string> = {
  [CLASSIFIER_SHARED_SCOPE]: CLASSIFIER_SHARED_LABEL,
  ...CLASSIFIER_KIND_LABELS,
};

function isScope(value: string | undefined): value is Scope {
  return SCOPES.includes(value as Scope);
}

function SharedSettings({
  initial,
  canWrite,
  onSaved,
}: {
  initial: ClassifierSharedSettingsResponse;
  canWrite: boolean;
  onSaved: (shared: ClassifierSharedSettingsResponse) => void;
}) {
  const [shared, setShared] = useState(initial);

  async function save(patch: Partial<Omit<ClassifierSharedSettingsInput, "expectedRevision">>) {
    const body: ClassifierSharedSettingsInput = {
      expectedRevision: shared.revision,
      context: shared.context,
      questions: shared.questions,
      ...patch,
    };
    const saved = await putJson(`${CLASSIFIERS_API}/${CLASSIFIER_SHARED_SCOPE}`, body, classifierSavedResponseSchema);
    const next = { ...shared, ...body, revision: saved.revision, saved: true };
    setShared(next);
    onSaved(next);
    toast("Classifier saved", "success");
  }

  async function saveQuestion(question: ClassifierQuestion, replacing: string | null) {
    const questions = replacing
      ? shared.questions.map((candidate) => (candidate.id === replacing ? question : candidate))
      : [...shared.questions, question];
    await save({ questions });
  }

  async function removeQuestion(question: ClassifierQuestion) {
    const confirmed = await confirmAction({
      title: `Remove ${question.id}?`,
      body: "Kinds and events that changed this question keep their own version.",
      confirmLabel: "Remove question",
      tone: "danger",
    });
    if (confirmed) await save({ questions: shared.questions.filter((candidate) => candidate.id !== question.id) });
  }

  return (
    <>
      <ClassifierContext
        key={shared.revision}
        schema={classifierSharedSettingsInputSchema}
        bodyFor={(context) => ({ expectedRevision: shared.revision, questions: shared.questions, context })}
        context={shared.context}
        term={CLASSIFIER_SHARED_LABEL}
        help="What the model reads first for every kind: who PKIC is, who takes part, and the rules for everything people write or upload."
        canEdit={canWrite}
        onSave={(context) => save({ context })}
      />
      <ClassifierQuestions
        caption={`${CLASSIFIER_SHARED_LABEL} classifier questions`}
        rows={shared.questions.map((question) => ({ question }))}
        canWrite={canWrite}
        onSave={saveQuestion}
        onRemove={(question) =>
          void removeQuestion(question).catch((error: unknown) => toast((error as Error).message, "error"))
        }
      />
    </>
  );
}

function KindSettings({
  initial,
  shared,
  canWrite,
  onSaved,
}: {
  initial: ClassifierSettingsResponse;
  shared: ClassifierSharedSettingsResponse;
  canWrite: boolean;
  onSaved: (settings: ClassifierSettingsResponse) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const label = CLASSIFIER_KIND_LABELS[settings.kind];

  async function save(patch: Partial<Omit<ClassifierSettingsInput, "expectedRevision">>) {
    const body: ClassifierSettingsInput = {
      expectedRevision: settings.revision,
      enabled: settings.enabled,
      model: settings.model,
      context: settings.context,
      questions: settings.questions,
      disabledQuestionIds: settings.disabledQuestionIds,
      ...patch,
    };
    const saved = await putJson(`${CLASSIFIERS_API}/${settings.kind}`, body, classifierSavedResponseSchema);
    const next = { ...settings, ...body, revision: saved.revision, saved: true };
    setSettings(next);
    onSaved(next);
    toast("Classifier saved", "success");
  }

  return (
    <>
      <ClassifierBasics key={settings.revision} settings={settings} canWrite={canWrite} onSave={save} />
      <LayeredClassifierQuestions
        caption={`${label} classifier questions`}
        below={shared.questions}
        layer={settings}
        names={{ below: CLASSIFIER_SHARED_LABEL, layer: label, changeFor: label.toLowerCase() }}
        removeBody="Events that changed or turned off this question keep their own version."
        canWrite={canWrite}
        onSave={save}
      />
      <ClassifierTrial
        kind={settings.kind}
        check={wideClassifier(shared, settings)}
        trialUrl={`${CLASSIFIERS_API}/${settings.kind}/trials`}
      />
    </>
  );
}

export function Classifiers({ canWrite, kind: requested }: { canWrite: boolean; kind?: string }) {
  const state = useData(() => getJson(CLASSIFIERS_API, classifierSettingsListResponseSchema), []);
  const scope = isScope(requested) ? requested : CLASSIFIER_SHARED_SCOPE;
  // What was saved here, so a tab left and revisited starts from the saved settings and their revision.
  const [saved, setSaved] = useState<Partial<Record<ClassifierKind, ClassifierSettingsResponse>>>({});
  const [savedShared, setSavedShared] = useState<ClassifierSharedSettingsResponse | null>(null);
  const shared = savedShared ?? state.data?.shared;
  const settings =
    scope === CLASSIFIER_SHARED_SCOPE
      ? undefined
      : (saved[scope] ?? state.data?.classifiers.find((check) => check.kind === scope));

  return (
    <div class="pk pk-stack">
      <PageHeader
        title="Classifiers"
        description="A model reads chat messages, questions, proposals, slides, member pages and personal profiles, and advises or blocks what breaks the rules. All content holds the rules every kind shares; events add their own context and questions."
      />
      <Tabs
        label="Kinds of content"
        items={SCOPES.map((key) => ({ key, label: SCOPE_LABELS[key] }))}
        active={scope}
        hrefFor={(key) => `/settings/classifiers/${key}`}
      />
      {state.loading && !state.data ? (
        <Spinner label="Loading the classifiers…" />
      ) : state.error ? (
        <ErrorAlert error={state.error} />
      ) : !shared ? null : settings ? (
        <KindSettings
          key={scope}
          initial={settings}
          shared={shared}
          canWrite={canWrite}
          onSaved={(next) => setSaved((current) => ({ ...current, [next.kind]: next }))}
        />
      ) : scope === CLASSIFIER_SHARED_SCOPE ? (
        <SharedSettings key={scope} initial={shared} canWrite={canWrite} onSaved={setSavedShared} />
      ) : null}
    </div>
  );
}
