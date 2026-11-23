/**
 * An event's classifiers: the PKIC-wide questions it starts from, which
 * it may turn off or replace, its own questions, and the context it adds,
 * such as its topics, tracks and terms. The test bench runs the check as it
 * runs for this event.
 */
import { useState } from "preact/hooks";
import {
  CLASSIFIER_KIND_LABELS,
  EVENT_CLASSIFIER_KINDS,
  type EventClassifierKind,
} from "../../../../../shared/classifiers";
import {
  classifierEventAdditionsInputSchema,
  classifierSavedResponseSchema,
  eventClassifierResponseSchema,
  type ClassifierEventAdditionsInput,
  type EventClassifierResponse,
} from "../../../../../shared/schemas/classifiers";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { toast } from "../../ui";
import { ClassifierContext } from "./ClassifierContext";
import { ClassifierTrial } from "./ClassifierTrial";
import { LayeredClassifierQuestions } from "./LayeredClassifierQuestions";

function isKind(value: string | undefined): value is EventClassifierKind {
  return EVENT_CLASSIFIER_KINDS.includes(value as EventClassifierKind);
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

  async function save(patch: Partial<Omit<ClassifierEventAdditionsInput, "expectedRevision">>) {
    const body: ClassifierEventAdditionsInput = {
      expectedRevision: check.additions.revision,
      context: check.additions.context,
      questions: check.additions.questions,
      disabledQuestionIds: check.additions.disabledQuestionIds,
      ...patch,
    };
    const saved = await putJson(apiPath, body, classifierSavedResponseSchema);
    // The save is done; keep its revision so the next save does not conflict, even if the reload fails.
    setCheck((current) => ({ ...current, additions: { ...current.additions, ...patch, revision: saved.revision } }));
    toast("Classifier saved", "success");
    try {
      setCheck(await getJson(apiPath, eventClassifierResponseSchema));
    } catch {
      toast("The classifier was saved, but this view could not refresh. Reload the page to see the latest.", "error");
    }
  }

  return (
    <>
      {!check.settings.enabled && (
        <Alert tone="info">This classifier is off PKIC-wide, so it does not run for this event either.</Alert>
      )}
      <ClassifierContext
        key={check.additions.revision}
        schema={classifierEventAdditionsInputSchema}
        bodyFor={(context) => ({ expectedRevision: check.additions.revision, ...check.additions, context })}
        context={check.additions.context}
        term="This event"
        help="Added after the PKIC-wide context: the event's topics and tracks, its audience, and this year's terms."
        below={{ term: "PKIC-wide", context: check.settings.context }}
        canEdit={canEdit}
        onSave={(context) => save({ context })}
      />
      <LayeredClassifierQuestions
        caption={`${CLASSIFIER_KIND_LABELS[check.kind]} classifier questions for this event`}
        below={check.settings.questions}
        layer={check.additions}
        names={{ below: "PKIC-wide", layer: "This event", changeFor: "this event" }}
        canWrite={canEdit}
        onSave={save}
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
  const kind = isKind(requested) ? requested : "chat";
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
        <Spinner label="Loading the classifier…" />
      ) : state.error ? (
        <ErrorAlert error={state.error} />
      ) : state.data ? (
        <KindAdditions key={kind} initial={state.data} apiPath={apiPath} canEdit={canEdit} />
      ) : null}
    </div>
  );
}
