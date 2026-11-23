/**
 * An event's automatic checks: the PKIC-wide questions it starts from, which
 * it may turn off or replace, its own questions, and the context it adds,
 * such as its topics, tracks and terms. The test bench runs the check as it
 * runs for this event.
 */
import { useState } from "preact/hooks";
import {
  CLASSIFIER_KIND_LABELS,
  EVENT_CLASSIFIER_KINDS,
  type EventClassifierKind,
  type ClassifierQuestion,
} from "../../../../../shared/classifiers";
import {
  classifierSavedResponseSchema,
  eventClassifierResponseSchema,
  type ClassifierEventAdditionsInput,
  type EventClassifierResponse,
} from "../../../../../shared/schemas/classifiers";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { toast } from "../../ui";
import { ClassifierQuestions } from "./ClassifierQuestions";
import type { ClassifierQuestionRow } from "./ClassifierQuestionTable";
import { ClassifierTrial } from "./ClassifierTrial";
import { EventClassifierContext } from "./EventClassifierContext";

function isKind(value: string | undefined): value is EventClassifierKind {
  return EVENT_CLASSIFIER_KINDS.includes(value as EventClassifierKind);
}

/** Every question in one list: PKIC-wide ones first, each marked off or replaced, then the event's own. */
function questionRows(check: EventClassifierResponse): ClassifierQuestionRow[] {
  const disabled = new Set(check.additions.disabledQuestionIds);
  const own = new Map(check.additions.questions.map((question) => [question.id, question]));
  const rows: ClassifierQuestionRow[] = check.settings.questions.map((question) => {
    const replacement = own.get(question.id);
    return replacement
      ? { question: replacement, source: "This event", off: disabled.has(question.id) }
      : { question, source: "PKIC-wide", off: disabled.has(question.id) };
  });
  const shared = new Set(check.settings.questions.map((question) => question.id));
  for (const question of check.additions.questions)
    if (!shared.has(question.id)) rows.push({ question, source: "This event", off: disabled.has(question.id) });
  return rows;
}

function KindAdditions({
  initial,
  apiPath,
  canEdit,
}: {
  initial: EventClassifierResponse;
  apiPath: string;
  canEdit: boolean;
}) {
  const [check, setCheck] = useState(initial);
  const shared = new Set(check.settings.questions.map((question) => question.id));

  async function save(patch: Partial<Omit<ClassifierEventAdditionsInput, "expectedRevision">>) {
    const body: ClassifierEventAdditionsInput = {
      expectedRevision: check.additions.revision,
      context: check.additions.context,
      questions: check.additions.questions,
      disabledQuestionIds: check.additions.disabledQuestionIds,
      ...patch,
    };
    await putJson(apiPath, body, classifierSavedResponseSchema);
    setCheck(await getJson(apiPath, eventClassifierResponseSchema));
    toast("Check saved", "success");
  }

  const report = (error: unknown) => toast((error as Error).message, "error");

  async function saveQuestion(question: ClassifierQuestion, replacing: string | null) {
    const others = check.additions.questions.filter((candidate) => candidate.id !== (replacing ?? question.id));
    await save({ questions: [...others, question] });
  }

  async function removeQuestion(question: ClassifierQuestion) {
    const restores = shared.has(question.id);
    const confirmed = await confirmAction({
      title: restores ? `Use the PKIC-wide ${question.id}?` : `Remove ${question.id}?`,
      body: restores ? "The event's version goes, and the PKIC-wide question applies again." : undefined,
      confirmLabel: restores ? "Use PKIC-wide" : "Remove question",
      tone: "danger",
    });
    if (confirmed)
      await save({ questions: check.additions.questions.filter((candidate) => candidate.id !== question.id) });
  }

  function toggle(row: ClassifierQuestionRow) {
    const disabled = new Set(check.additions.disabledQuestionIds);
    if (row.off) disabled.delete(row.question.id);
    else disabled.add(row.question.id);
    void save({ disabledQuestionIds: [...disabled] }).catch(report);
  }

  return (
    <>
      {!check.settings.enabled && (
        <Alert tone="info">This check is off PKIC-wide, so it does not run for this event either.</Alert>
      )}
      <EventClassifierContext
        key={check.additions.revision}
        check={check}
        canEdit={canEdit}
        onSave={(context) => save({ context })}
      />
      <ClassifierQuestions
        caption={`${CLASSIFIER_KIND_LABELS[check.kind]} questions for this event`}
        rows={questionRows(check)}
        canWrite={canEdit}
        editLabel={(row) => (row.source === "PKIC-wide" ? "Change for this event" : "Change")}
        removeLabel={(row) =>
          row.source === "PKIC-wide" ? null : shared.has(row.question.id) ? "Use the PKIC-wide version" : "Remove"
        }
        extraActions={(row) => [{ id: "toggle", label: row.off ? "Turn on" : "Turn off", onSelect: () => toggle(row) }]}
        onSave={saveQuestion}
        onRemove={(question) => void removeQuestion(question).catch(report)}
      />
      <ClassifierTrial kind={check.kind} check={check.effective} trialUrl={`${apiPath}/trials`} />
    </>
  );
}

export function EventClassifiers({
  slug,
  kind: requested,
  canEdit,
  hrefFor,
}: {
  slug: string;
  kind?: string;
  canEdit: boolean;
  hrefFor: (kind: EventClassifierKind) => string;
}) {
  const kind = isKind(requested) ? requested : "chat_message";
  const apiPath = `/api/v1/events/${encodeURIComponent(slug)}/classifiers/${kind}`;
  const state = useData(() => getJson(apiPath, eventClassifierResponseSchema), [apiPath]);
  return (
    <div class="pk pk-stack">
      <Tabs
        label="Kinds of content"
        items={EVENT_CLASSIFIER_KINDS.map((key) => ({ key, label: CLASSIFIER_KIND_LABELS[key] }))}
        active={kind}
        hrefFor={(key) => hrefFor(key as EventClassifierKind)}
      />
      {state.loading && !state.data ? (
        <Spinner label="Loading the check…" />
      ) : state.error ? (
        <ErrorAlert error={state.error} />
      ) : state.data ? (
        <KindAdditions key={kind} initial={state.data} apiPath={apiPath} canEdit={canEdit} />
      ) : null}
    </div>
  );
}
