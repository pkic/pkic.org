import { useEffect, useState } from "preact/hooks";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import { eventFormsResponseSchema, type EventFormsResponse } from "../../../../../../../shared/schemas/forms";
import { deriveFormSubmissionWindowState } from "../../../../../../../shared/form-submission-window";
import { eventClock } from "../../../../../../../shared/event-clock";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import {
  SubmissionWindowFields,
  instantFromLocal,
  localFromInstant,
} from "../../../../../../components/forms/SubmissionWindowFields";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useEventSettingsSave, type EventSettingsGroupTarget } from "./useEventSettingsSave";
import { getJson } from "../../../../../../shared/api-client";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { EditActions } from "../../../../../../ui/EditActions";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Alert } from "../../../../../../ui/Alert";
import { Spinner } from "../../../../../../components/Spinner";
import { EventFormLinkSelect } from "./EventFormLinkSelect";

export function ProposalCallSettings({
  event,
  onUpdated,
  groupSettings,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
  groupSettings?: EventSettingsGroupTarget;
}) {
  const [configuration, setConfiguration] = useState<EventFormsResponse | null>(null);
  const [draft, setDraft] = useState({ opensAt: "", closesAt: "", formKey: "" });
  const [loading, setLoading] = useState(true);
  const window = configuration?.form?.placement;
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: event.updatedAt,
    proposalFormKey: draft.formKey || null,
    proposalSubmissionWindow: draft.formKey
      ? {
          opensAt: instantFromLocal(draft.opensAt, event.timezone),
          closesAt: instantFromLocal(draft.closesAt, event.timezone),
        }
      : undefined,
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(
    event.slug,
    form,
    onUpdated,
    groupSettings,
  );
  useEffect(() => {
    let current = true;
    setLoading(true);
    void getJson(
      `/api/v1/events/${encodeURIComponent(event.slug)}/forms/placements/proposal_submission`,
      eventFormsResponseSchema,
    )
      .then((result) => {
        if (current) setConfiguration(result);
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [event.slug, event.updatedAt]);
  function reset() {
    setDraft({
      opensAt: localFromInstant(window?.opensAt ?? null, event.timezone),
      closesAt: localFromInstant(window?.closesAt ?? null, event.timezone),
      formKey: configuration?.form?.key ?? "",
    });
    form.reset();
    setError("");
  }
  const state = window ? deriveFormSubmissionWindowState(window, new Date().toISOString()) : "open";
  const status = !configuration?.form
    ? "Not set up"
    : event.endsAt && event.endsAt <= new Date().toISOString()
      ? "Closed"
      : state === "scheduled"
        ? "Scheduled"
        : state === "closed"
          ? "Closed"
          : "Open";
  return (
    <Panel aria-label="Call for proposals">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Call for proposals">
          {(groupSettings ? groupSettings.canEdit : event.capabilities.includes("write")) && !loading && (
            <EditActions
              label="Call for proposals actions"
              editing={editing}
              saving={saving}
              saveLabel="Save call for proposals"
              editLabel="Edit CFP settings"
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          {loading ? (
            <Spinner />
          ) : editing ? (
            <>
              <EventFormLinkSelect
                eventSlug={event.slug}
                purpose="proposal_submission"
                label="Proposal form"
                value={draft.formKey}
                disabled={saving}
                help="Choose the form this event should use for proposals."
                presentation={form.of("proposalFormKey")}
                onChange={(formKey) => setDraft((current) => ({ ...current, formKey }))}
              />
              {draft.formKey && (
                <SubmissionWindowFields
                  timeZone={event.timezone}
                  zoneOwner="Event time"
                  opensAt={draft.opensAt}
                  closesAt={draft.closesAt}
                  onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                  fieldProps={{
                    opensAt: form.of("proposalSubmissionWindow.opensAt"),
                    closesAt: form.of("proposalSubmissionWindow.closesAt"),
                  }}
                />
              )}
            </>
          ) : (
            <DescriptionList
              items={[
                { term: "Status", value: status },
                { term: "Proposal form", value: configuration?.form?.title ?? "No proposal form" },
                {
                  term: "Opens",
                  value: window?.opensAt
                    ? formatDateTimeInZone(window.opensAt, eventClock(event))
                    : "No opening restriction",
                },
                {
                  term: "Closes",
                  value: window?.closesAt
                    ? formatDateTimeInZone(window.closesAt, eventClock(event))
                    : "No closing restriction",
                },
                { term: "Time zone", value: event.timezone },
              ]}
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
