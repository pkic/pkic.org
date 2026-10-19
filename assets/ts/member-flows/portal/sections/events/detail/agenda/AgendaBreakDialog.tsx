import { AgendaLocationSelect } from "./AgendaLocationSelect";
import { AgendaSponsorFields } from "./AgendaSponsorFields";
import { useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaSnapshotSchema } from "../../../../../../../shared/schemas/event-agenda";
import { agendaBreaksCreateSchema } from "../../../../../../../shared/schemas/event-agenda-breaks";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { formatCalendarDate } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { resolveAgendaDurationRules } from "../../../../../../../shared/event-agenda-duration";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useEditorFocus } from "./useEditorFocus";
import type { agendaPresenter } from "./presenter";

/** Author one fixed break per selected day, sharing its location scope. */
export function AgendaBreakDialog({
  snapshot,
  days,
  viewedDay,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  days: ReturnType<typeof agendaPresenter>;
  viewedDay?: string;
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const initialDay = days.find((day) => day.date === viewedDay) ?? days[0];
  const [selectedDays, setDays] = useState(initialDay ? [initialDay.date] : []);
  const [title, setTitle] = useState("Break");
  const [preset, setPreset] = useState("Break");
  const [time, setTime] = useState(
    initialDay?.slots[0] ? instantToDateTimeLocal(initialDay.slots[0].startsAt, snapshot.timeZone).slice(11, 16) : "",
  );
  const [duration, setDuration] = useState(String(resolveAgendaDurationRules(snapshot.durationRules).defaultMinutes));
  const [allLocations, setAllLocations] = useState(true);
  const [roomIds, setRooms] = useState<string[]>([]);
  const [sponsorIds, setSponsorIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let conversionError = "";
  const intervals = selectedDays.map((date) => {
    try {
      const startAt = dateTimeLocalToIso(`${date}T${time}`, snapshot.timeZone);
      return { startAt, endAt: new Date(Date.parse(startAt) + Number(duration) * 60000).toISOString() };
    } catch (failure) {
      conversionError = failure instanceof Error ? failure.message : "Choose a valid time and duration.";
      return { startAt: `${date}T${time}`, endAt: "" };
    }
  });
  const form = useContractForm(agendaBreaksCreateSchema, {
    expectedRevision: snapshot.revision,
    title,
    intervals,
    roomIds: allLocations ? null : roomIds,
    sponsorIds,
  });
  async function save(event: Event) {
    event.preventDefault();
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(conversionError || checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/breaks`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      onClose();
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="Add break or lunch"
      confirmLabel={busy ? "Saving…" : "Add break"}
      confirmDisabled={busy}
      onConfirm={() => focus.current?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {error && <ErrorAlert error={error} />}
      <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} class="pk-fieldset pk-stack">
          <Field label="Preset">
            {(control) => (
              <Select
                {...control}
                name="title"
                value={preset}
                onChange={(event) => {
                  setPreset(event.currentTarget.value);
                  setTitle(event.currentTarget.value);
                }}
              >
                {["Break", "Lunch", "Networking"].map((value) => (
                  <option value={value}>{value}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Title" required {...form.of("title")}>
            {(control) => (
              <TextInput
                {...control}
                name="title"
                value={title}
                onInput={(event) => setTitle(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Starts" help={`Time in ${snapshot.timeZone}.`} {...form.of("intervals.0.startAt")}>
            {(control) => (
              <TextInput
                {...control}
                name="intervals.0.startAt"
                type="time"
                value={time}
                onInput={(event) => setTime(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Duration (minutes)" {...form.of("intervals.0.endAt")}>
            {(control) => (
              <TextInput
                {...control}
                name="intervals.0.endAt"
                type="number"
                value={duration}
                onInput={(event) => setDuration(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field group label="Days" {...form.of("intervals")}>
            {(control) => (
              <div class="pk-stack">
                <Checkbox
                  label="All days"
                  name="intervals"
                  checked={days.length > 0 && days.every((day) => selectedDays.includes(day.date))}
                  onChange={(event) => setDays(event.currentTarget.checked ? days.map((day) => day.date) : [])}
                />
                {days.map((day) => (
                  <Checkbox
                    key={day.date}
                    label={formatCalendarDate(day.date)}
                    name="intervals"
                    value={day.date}
                    aria-describedby={control["aria-describedby"]}
                    checked={selectedDays.includes(day.date)}
                    onChange={(event) =>
                      setDays(
                        event.currentTarget.checked
                          ? [...selectedDays, day.date]
                          : selectedDays.filter((date) => date !== day.date),
                      )
                    }
                  />
                ))}
                <p class="pk-muted">{formatNumber(selectedDays.length)} selected</p>
              </div>
            )}
          </Field>
          <AgendaLocationSelect
            rooms={snapshot.rooms}
            globalAll
            value={allLocations ? null : roomIds}
            onChange={(ids) => {
              setAllLocations(ids === null);
              setRooms(ids ?? []);
            }}
            {...form.of("roomIds")}
            help="All locations includes locations added later."
          />
          <AgendaSponsorFields
            slug={snapshot.eventSlug}
            value={sponsorIds}
            onChange={setSponsorIds}
            disabled={busy}
            {...form.of("sponsorIds")}
          />
        </fieldset>
      </form>
    </Dialog>
  );
}
