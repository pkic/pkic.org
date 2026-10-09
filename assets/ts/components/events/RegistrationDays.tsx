/**
 * The registration's days: one compact list, a calendar tile per day and how
 * the attendee joins it, with a single command to change them.
 *
 * In-person seats are limited and paid for, so a registration that holds one
 * leads with "Can't make it in person?". It opens every day's choices at once
 * as a short form — a segmented row of choices per day, one save — because a
 * reader skipping one day often skips another, and a button under every day
 * made the list read as three forms instead of one plan.
 */
import { useState } from "preact/hooks";

import { registrationManageSchema, type RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { calendarDateParts, formatDateTime } from "../../../shared/format-date";
import { useContractForm } from "../../hooks/useContractForm";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Radio } from "../../ui/Checkbox";
import { IconMapPin, IconMonitor, IconOnDemand } from "../../ui/MediaIcons";
import { dayStateLabel, IN_PERSON, registrationDays, type RegistrationDayView } from "./registration-day-changes";
import "./RegistrationDays.css";

type DayAttendance = Array<{ dayDate: string; attendanceType: string }>;

const NOT_ATTENDING = "";

function DateTile({ dayDate }: { dayDate: string }) {
  const parts = calendarDateParts(dayDate);
  return (
    <span class="pk-reg-day__date">
      <span class="pk-reg-day__weekday">{parts.weekday}</span>
      <span class="pk-reg-day__number">{parts.day}</span>
      <span class="pk-reg-day__month">{parts.month}</span>
    </span>
  );
}

function ModeIcon({ type }: { type: string | null }) {
  if (type === IN_PERSON) return <IconMapPin />;
  if (type === "on_demand") return <IconOnDemand />;
  if (type) return <IconMonitor />;
  return null;
}

function currentType(day: RegistrationDayView): string | null {
  return day.state.kind === "absent" ? null : day.state.attendanceType;
}

function DayRow({ day, busy, onClaim }: { day: RegistrationDayView; busy: boolean; onClaim: () => void }) {
  return (
    <li class="pk-reg-day" data-state={day.state.kind}>
      <DateTile dayDate={day.dayDate} />
      <span class="pk-reg-day__body">
        <span class="pk-reg-day__mode">
          <ModeIcon type={currentType(day)} />
          {dayStateLabel(day.state)}
        </span>
        {day.state.kind === "offered" && day.state.offerExpiresAt && (
          <span class="pk-small">Claim it before {formatDateTime(day.state.offerExpiresAt)}.</span>
        )}
      </span>
      {day.state.kind === "offered" ? (
        <Button variant="primary" size="sm" loading={busy} onClick={onClaim}>
          Claim seat
        </Button>
      ) : day.state.kind === "waiting" ? (
        <Badge tone="warn">Waiting list</Badge>
      ) : null}
    </li>
  );
}

function DaysForm({
  data,
  days,
  busy,
  onSave,
  onDiscard,
}: {
  data: RegistrationManageReadResponse;
  days: RegistrationDayView[];
  busy: boolean;
  onSave: (dayAttendance: DayAttendance) => void;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(days.map((day) => [day.dayDate, currentType(day) ?? NOT_ATTENDING])),
  );
  const dayAttendance = days
    .filter((day) => draft[day.dayDate])
    .map((day) => ({ dayDate: day.dayDate, attendanceType: draft[day.dayDate]! }));
  const form = useContractForm(registrationManageSchema, { action: "update", dayAttendance });
  const releasing = data.dayAttendance.some(
    (entry) => entry.attendanceType === IN_PERSON && draft[entry.dayDate] !== IN_PERSON,
  );
  const options = new Map(data.eventDays.map((day) => [day.dayDate, day.attendanceOptions]));

  return (
    <form
      class="pk-reg-days__form"
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        // No day left is not a day change: the caller treats it as cancelling.
        onSave(form.submit().data?.dayAttendance ?? []);
      }}
    >
      {days.map((day) => (
        <fieldset key={day.dayDate} class="pk-reg-days__choice">
          <legend class="pk-reg-days__legend">
            <DateTile dayDate={day.dayDate} />
          </legend>
          <div class="pk-reg-days__segments">
            {[...(options.get(day.dayDate) ?? []), { value: NOT_ATTENDING, label: "Not attending" }].map((option) => (
              <Radio
                key={option.value}
                class="pk-reg-days__segment"
                name={`day-${day.dayDate}`}
                value={option.value}
                label={option.label}
                checked={draft[day.dayDate] === option.value}
                onChange={() => setDraft({ ...draft, [day.dayDate]: option.value })}
              />
            ))}
          </div>
        </fieldset>
      ))}
      {releasing && (
        <p class="pk-small">
          Your in-person seat goes to the next person on the waiting list as soon as you save. If you change your mind
          later, you join the waiting list again.
        </p>
      )}
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={busy}>
          Save my days
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDiscard}>
          Discard changes
        </Button>
      </div>
    </form>
  );
}

export function RegistrationDays({
  data,
  busy,
  editable,
  onSave,
  onClaim,
  focusDay = null,
}: {
  data: RegistrationManageReadResponse;
  busy: boolean;
  /** False when the registration is cancelled or awaits confirmation: the days are read-only. */
  editable: boolean;
  onSave: (dayAttendance: DayAttendance) => void;
  onClaim: (dayDate: string) => void;
  /** Opens the choices on arrival, for a link such as "No, I can't make it". */
  focusDay?: string | null;
}) {
  const [editing, setEditing] = useState(Boolean(focusDay) && editable);
  const days = registrationDays(data);
  if (days.length === 0) return null;
  const holdsSeat = data.dayAttendance.some((entry) => entry.attendanceType === IN_PERSON);

  return (
    <section class="pk-reg-days" aria-label="Your days">
      <h3 class="pk-reg-days__title">Your days</h3>
      {editing ? (
        <DaysForm
          data={data}
          days={days}
          busy={busy}
          onSave={(dayAttendance) => {
            setEditing(false);
            onSave(dayAttendance);
          }}
          onDiscard={() => setEditing(false)}
        />
      ) : (
        <>
          <ul class="pk-reg-days__list">
            {days.map((day) => (
              <DayRow key={day.dayDate} day={day} busy={busy} onClaim={() => onClaim(day.dayDate)} />
            ))}
          </ul>
          {editable && (
            <div class="pk-cluster">
              <Button disabled={busy} onClick={() => setEditing(true)}>
                {holdsSeat ? "Can't make it in person?" : "Change my days"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
