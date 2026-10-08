import { useCallback, useMemo, useState } from "preact/hooks";
import {
  eventRecordingProviderMeetingsResponseSchema,
  eventRecordingProviderMeetingsQuerySchema,
  eventRecordingMeetingLinkSchema,
  eventRecordingMeetingSchema,
  eventRecordingMeetingsResponseSchema,
  eventRecordingMeetingsQuerySchema,
  eventRecordingDiscoveryQuerySchema,
  eventRecordingDiscoveryResponseSchema,
  type EventRecordingProviderMeeting,
  type EventRecordingMeeting,
} from "../../../../../../../shared/schemas/event-recording-discovery";
import {
  eventRecordingSourceBindSchema,
  eventRecordingSourceSchema,
  type EventRecordingSource,
} from "../../../../../../../shared/schemas/event-recordings";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { getJson, postJson } from "../../../../../../shared/api-client";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { Field } from "../../../../../../ui/Field";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { FormSection } from "../../../../../../ui/FormSection";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";

export function RecordingSourceEditor({
  slug,
  onSaved,
  onClose,
  canLinkProviderMeetings = false,
}: {
  slug: string;
  onSaved: (source: EventRecordingSource) => void;
  onClose: () => void;
  canLinkProviderMeetings?: boolean;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/recordings`;
  const [providerMeeting, setProviderMeeting] = useState<EventRecordingProviderMeeting | null>(null);
  const [meeting, setMeeting] = useState<EventRecordingMeeting | null>(null);
  const [recording, setRecording] = useState<{ id: string; label: string; page: number } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const linkForm = useContractForm(eventRecordingMeetingLinkSchema, {
    providerMeetingId: providerMeeting?.providerMeetingId ?? "",
  });
  const form = useContractForm(eventRecordingSourceBindSchema, {
    meetingLinkId: meeting?.id ?? "",
    recordingId: recording?.id ?? "",
    discoveryPage: recording?.page ?? 0,
  });
  const providerCatalog = useMemo(
    () => ({
      endpoint: `${endpoint}/meetings/discovery`,
      responseSchema: eventRecordingProviderMeetingsResponseSchema,
      resolveItems: (response: ReturnType<typeof eventRecordingProviderMeetingsResponseSchema.parse>) =>
        response.meetings,
      resolvePage: (response: ReturnType<typeof eventRecordingProviderMeetingsResponseSchema.parse>) => response.page,
      itemKey: (item: EventRecordingProviderMeeting) => item.providerMeetingId,
      itemLabel: (item: EventRecordingProviderMeeting) =>
        item.title || `Meeting from ${formatDateTime(item.createdAt)}`,
      sort: "",
    }),
    [endpoint],
  );
  const meetingCatalog = useMemo(
    () => ({
      endpoint: `${endpoint}/meetings`,
      responseSchema: eventRecordingMeetingsResponseSchema,
      resolveItems: (response: ReturnType<typeof eventRecordingMeetingsResponseSchema.parse>) => response.meetings,
      resolvePage: (response: ReturnType<typeof eventRecordingMeetingsResponseSchema.parse>) => response.page,
      itemKey: (item: EventRecordingMeeting) => item.id,
      itemLabel: (item: EventRecordingMeeting) => item.title,
      sort: "title",
    }),
    [endpoint],
  );
  const recordingCatalog = useMemo(
    () => ({
      endpoint: `${endpoint}/discovery`,
      params: { meetingLinkId: meeting?.id ?? "" },
      responseSchema: eventRecordingDiscoveryResponseSchema,
      resolveItems: (response: ReturnType<typeof eventRecordingDiscoveryResponseSchema.parse>) =>
        response.recordings.map((item) => ({
          id: item.recordingId,
          label: `${formatDateTime(item.startedAt)} · ${item.status.toLowerCase()} · ${formatNumber(item.fileBytes)} bytes`,
          page: response.page.offset / 100,
        })),
      resolvePage: (response: ReturnType<typeof eventRecordingDiscoveryResponseSchema.parse>) => response.page,
      itemKey: (item: { id: string }) => item.id,
      itemLabel: (item: { label: string }) => item.label,
      sort: "",
    }),
    [endpoint, meeting?.id],
  );
  const providerLoad: CollectionLoader = useCallback((url, signal, schema) => {
    const parsed = new URL(url, window.location.origin);
    eventRecordingProviderMeetingsQuerySchema.parse(Object.fromEntries(parsed.searchParams));
    return getJson(url, schema, { signal });
  }, []);
  const meetingLoad: CollectionLoader = useCallback((url, signal, schema) => {
    const parsed = new URL(url, window.location.origin);
    eventRecordingMeetingsQuerySchema.parse(Object.fromEntries(parsed.searchParams));
    return getJson(url, schema, { signal });
  }, []);
  const recordingLoad: CollectionLoader = useCallback((url, signal, schema) => {
    const parsed = new URL(url, window.location.origin);
    eventRecordingDiscoveryQuerySchema.parse(Object.fromEntries(parsed.searchParams));
    return getJson(url, schema, { signal });
  }, []);
  async function link() {
    const checked = linkForm.submit();
    if (!checked.data || busy) {
      setError(checked.message ?? "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setMeeting(await postJson(`${endpoint}/meetings`, checked.data, eventRecordingMeetingSchema));
      setRecording(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The meeting could not be linked.");
    } finally {
      setBusy(false);
    }
  }
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data || busy) {
      setError(checked.message ?? "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(await postJson(`${endpoint}/sources`, checked.data, eventRecordingSourceSchema));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The recording could not be added.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Add recording">
      <h3>Add recording</h3>
      {error && <ErrorAlert error={error} />}
      <form
        {...linkForm.handlers}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void link();
        }}
      >
        <FormSection title="Event meeting">
          <Field label="Linked meeting">
            {(control) => (
              <ServerSearchSelect
                {...control}
                catalog={meetingCatalog}
                load={meetingLoad}
                searchLabel="Linked meeting"
                value={meeting?.id ?? null}
                selectedLabel={meeting?.title}
                disabled={busy}
                onChange={(item) => {
                  setMeeting(item);
                  setRecording(null);
                }}
              />
            )}
          </Field>
          {canLinkProviderMeetings && (
            <>
              <Field label="Another provider meeting" {...linkForm.of("providerMeetingId")}>
                {(control) => (
                  <ServerSearchSelect
                    {...control}
                    catalog={providerCatalog}
                    load={providerLoad}
                    searchLabel="Provider meeting"
                    value={providerMeeting?.providerMeetingId ?? null}
                    selectedLabel={providerMeeting?.title}
                    disabled={busy}
                    onChange={setProviderMeeting}
                  />
                )}
              </Field>
              <Button type="submit" disabled={!providerMeeting || busy}>
                Link selected meeting to this event
              </Button>
            </>
          )}
        </FormSection>
      </form>
      <form noValidate {...form.handlers} onSubmit={save}>
        {meeting && (
          <Field label="Recording" {...form.of("recordingId")}>
            {(control) => (
              <ServerSearchSelect
                {...control}
                catalog={recordingCatalog}
                load={recordingLoad}
                searchLabel="Recording"
                pageSize={100}
                searchable={false}
                value={recording?.id ?? null}
                selectedLabel={recording?.label}
                disabled={busy}
                onChange={setRecording}
              />
            )}
          </Field>
        )}
        <p>Adding a recording does not acquire or publish its file. Rights and consent are reviewed separately.</p>
        <Button type="submit" disabled={busy || !recording} loading={busy}>
          Add recording
        </Button>
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
      </form>
    </section>
  );
}
