/**
 * An event's automatic checks: the PKIC-wide questions it starts from, which
 * it may turn off or replace, its own questions, and the context it adds,
 * such as its topics, tracks and terms. The test bench runs the check as it
 * runs for this event.
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
  eventContentCheckResponseSchema,
  type ContentCheckEventAdditionsInput,
  type EventContentCheckResponse,
} from "../../../../../shared/schemas/content-checks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { toast } from "../../ui";
import { ContentCheckQuestions } from "./ContentCheckQuestions";
import type { ContentCheckQuestionRow } from "./ContentCheckQuestionTable";
import { ContentCheckTrial } from "./ContentCheckTrial";
import { EventContentCheckContext } from "./EventContentCheckContext";

function isKind(value: string | undefined): value is ContentCheckKind {
  return CONTENT_CHECK_KINDS.includes(value as ContentCheckKind);
}

/** Every question in one list: PKIC-wide ones first, each marked off or replaced, then the event's own. */
function questionRows(check: EventContentCheckResponse): ContentCheckQuestionRow[] {
  const disabled = new Set(check.additions.disabledQuestionIds);
  const own = new Map(check.additions.questions.map((question) => [question.id, question]));
  const rows: ContentCheckQuestionRow[] = check.settings.questions.map((question) => {
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
  initial: EventContentCheckResponse;
  apiPath: string;
  canEdit: boolean;
}) {
  const [check, setCheck] = useState(initial);
  const shared = new Set(check.settings.questions.map((question) => question.id));

  async function save(patch: Partial<Omit<ContentCheckEventAdditionsInput, "expectedRevision">>) {
    const body: ContentCheckEventAdditionsInput = {
      expectedRevision: check.additions.revision,
      context: check.additions.context,
      questions: check.additions.questions,
      disabledQuestionIds: check.additions.disabledQuestionIds,
      ...patch,
    };
    await putJson(apiPath, body, contentCheckSavedResponseSchema);
    setCheck(await getJson(apiPath, eventContentCheckResponseSchema));
    toast("Check saved", "success");
  }

  const report = (error: unknown) => toast((error as Error).message, "error");

  async function saveQuestion(question: ContentCheckQuestion, replacing: string | null) {
    const others = check.additions.questions.filter((candidate) => candidate.id !== (replacing ?? question.id));
    await save({ questions: [...others, question] });
  }

  async function removeQuestion(question: ContentCheckQuestion) {
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

  function toggle(row: ContentCheckQuestionRow) {
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
      <EventContentCheckContext
        key={check.additions.revision}
        check={check}
        canEdit={canEdit}
        onSave={(context) => save({ context })}
      />
      <ContentCheckQuestions
        caption={`${CONTENT_CHECK_KIND_LABELS[check.kind]} questions for this event`}
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
      <ContentCheckTrial kind={check.kind} check={check.effective} trialUrl={`${apiPath}/trials`} />
    </>
  );
}

export function EventContentChecks({
  slug,
  kind: requested,
  canEdit,
  hrefFor,
}: {
  slug: string;
  kind?: string;
  canEdit: boolean;
  hrefFor: (kind: ContentCheckKind) => string;
}) {
  const kind = isKind(requested) ? requested : "chat_message";
  const apiPath = `/api/v1/events/${encodeURIComponent(slug)}/content-checks/${kind}`;
  const state = useData(() => getJson(apiPath, eventContentCheckResponseSchema), [apiPath]);
  return (
    <div class="pk pk-stack">
      <Tabs
        label="Kinds of content"
        items={CONTENT_CHECK_KINDS.map((key) => ({ key, label: CONTENT_CHECK_KIND_LABELS[key] }))}
        active={kind}
        hrefFor={(key) => hrefFor(key as ContentCheckKind)}
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
