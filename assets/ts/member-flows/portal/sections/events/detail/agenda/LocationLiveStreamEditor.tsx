/**
 * A location's live stream, beside its editor: the YouTube broadcast registered attendees watch in the event
 * app's virtual room, and a replacement for any single event day. Saved on its own, at once, without a new
 * agenda publication, because broadcasts are often replaced on the day itself.
 */
import { useState } from "preact/hooks";
import { eventVirtualRoomRoute } from "../../../../../../../shared/event-participation-link";
import { formatDayList } from "../../../../../../../shared/format-date";
import {
  locationLiveStreamResponseSchema,
  locationLiveStreamUpdateSchema,
  type LocationLiveStreamResponse,
} from "../../../../../../../shared/schemas/event-live-stream";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useData } from "../../../../../../hooks/useData";
import { getJson, putJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { TextInput } from "../../../../../../ui/TextControl";
import { usePortalHashLocation } from "../../../../hash-location";

function streamPath(slug: string, roomId: string) {
  return `/api/v1/events/${encodeURIComponent(slug)}/agenda/rooms/${encodeURIComponent(roomId)}/stream`;
}

export function LocationLiveStreamEditor({ slug, roomId }: { slug: string; roomId: string }) {
  const loaded = useData(() => getJson(streamPath(slug, roomId), locationLiveStreamResponseSchema), [slug, roomId]);
  return (
    <Panel>
      <PanelHeader title="Live stream" />
      <PanelBody class="pk-stack">
        {loaded.loading ? (
          <Spinner label="Loading the live stream…" />
        ) : loaded.data ? (
          <LiveStreamForm slug={slug} current={loaded.data} />
        ) : (
          <ErrorAlert error={loaded.error ?? "The live stream could not be loaded."} />
        )}
      </PanelBody>
    </Panel>
  );
}

function storedDays(stream: LocationLiveStreamResponse): Record<string, string> {
  return Object.fromEntries(stream.days.map((day) => [day.dayDate, day.stream.videoId]));
}

function LiveStreamForm({ slug, current }: { slug: string; current: LocationLiveStreamResponse }) {
  const [usual, setUsual] = useState(current.stream?.videoId ?? "");
  const [days, setDays] = useState(() => storedDays(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // Only the days given their own stream are sent, in the event's day order.
  const replaced = current.eventDays.filter((dayDate) => days[dayDate]?.trim());
  const form = useContractForm(locationLiveStreamUpdateSchema, {
    videoId: usual.trim() || null,
    days: replaced.map((dayDate) => ({ dayDate, videoId: days[dayDate]!.trim() })),
  });
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      // The fields show what is stored now: the video IDs, not the links that were pasted.
      const stored = await putJson(streamPath(slug, current.roomId), checked.data, locationLiveStreamResponseSchema);
      setUsual(stored.stream?.videoId ?? "");
      setDays(storedDays(stored));
      setSaved(true);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form noValidate class="pk-stack" {...form.handlers} onSubmit={(event) => void save(event)}>
      <p class="pk-muted">
        Registered attendees watch this location in the event app's virtual room. Changes apply at once; the agenda does
        not need to be published again.
      </p>
      {error && <ErrorAlert error={error} />}
      <Field
        label="Live stream"
        help="Paste the YouTube link of the broadcast, or its video ID. Leave empty when this location is not streamed."
        {...form.of("videoId")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="videoId"
            value={usual}
            onInput={(event) => {
              setUsual(event.currentTarget.value);
              setSaved(false);
            }}
          />
        )}
      </Field>
      {current.eventDays.length > 1 && (
        <fieldset class="pk-stack">
          <legend>A different stream on one day</legend>
          <p class="pk-muted">Leave a day empty to show the live stream above.</p>
          {current.eventDays.map((dayDate) => {
            const index = replaced.indexOf(dayDate);
            const name = index >= 0 ? `days.${index}.videoId` : `day-${dayDate}`;
            return (
              <Field key={dayDate} label={formatDayList([dayDate])} {...form.of(name)}>
                {(control) => (
                  <TextInput
                    {...control}
                    name={name}
                    value={days[dayDate] ?? ""}
                    onInput={(event) => {
                      setDays({ ...days, [dayDate]: event.currentTarget.value });
                      setSaved(false);
                    }}
                  />
                )}
              </Field>
            );
          })}
        </fieldset>
      )}
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={busy}>
          Save live stream
        </Button>
        <a href={usePortalHashLocation.hrefs(eventVirtualRoomRoute(slug, { room: current.roomId }))}>
          Open the virtual room
        </a>
        {saved && (
          <span class="pk-muted" role="status">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
