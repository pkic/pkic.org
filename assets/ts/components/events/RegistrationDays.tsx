/**
 * The registration's days: the shared day summary, and the two ways to change
 * them.
 *
 * In-person seats are limited and paid for, so a registration holding one
 * leads with "Can't make it in person?" — a short guided dialog that releases
 * seats to the waiting list. Other changes (joining in person, switching a day
 * between online and on demand) open the same day picker the registration form
 * uses. Moving a day to in-person goes through the server's waiting list like
 * any registration; a waiting day is kept as in-person, so saving it unchanged
 * keeps its place in the queue.
 */
import { useState } from "preact/hooks";

import { registrationManageSchema, type RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { useContractForm } from "../../hooks/useContractForm";
import { Button } from "../../ui/Button";
import { DayAttendancePicker, NOT_ATTENDING } from "../DayAttendancePicker";
import { RegistrationDayStatusSummary } from "../RegistrationDayStatusSummary";
import { IN_PERSON, registrationDays, type RegistrationDayView } from "./registration-day-changes";
import { ReleaseSeatDialog, releasableDays } from "./ReleaseSeatDialog";
import "./RegistrationDays.css";

type DayAttendance = Array<{ dayDate: string; attendanceType: string }>;

function currentType(day: RegistrationDayView): string | null {
  return day.state.kind === "absent" ? null : day.state.attendanceType;
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
  // Only a confirmed seat is released; a day still waiting holds none.
  const releasing = days.some(
    (day) => day.state.kind === "attending" && currentType(day) === IN_PERSON && draft[day.dayDate] !== IN_PERSON,
  );
  const joining = days.some((day) => draft[day.dayDate] === IN_PERSON && currentType(day) !== IN_PERSON);

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
      <DayAttendancePicker
        days={data.eventDays}
        value={draft}
        onChange={(dayDate, attendanceType) => setDraft({ ...draft, [dayDate]: attendanceType })}
        allowNotAttending
      />
      {joining && (
        <p class="pk-small">
          In-person seats are limited. If a day is full, you join its waiting list and we email you when a seat opens.
        </p>
      )}
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
  onClaim: (dayDates: string[]) => void;
  /** Opens the release dialog on arrival with this day chosen, for a link such as "No, I can't make it". */
  focusDay?: string | null;
}) {
  const seats = releasableDays(data);
  const [releasing, setReleasing] = useState(Boolean(focusDay) && editable && seats.length > 0);
  const [editing, setEditing] = useState(false);
  const days = registrationDays(data);
  if (days.length === 0) return null;

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
          <RegistrationDayStatusSummary
            dayAttendance={data.dayAttendance}
            dayWaitlist={data.dayWaitlist}
            busy={busy}
            onClaim={editable ? onClaim : undefined}
          />
          {editable && (
            <div class="pk-cluster">
              {seats.length > 0 && (
                <Button disabled={busy} onClick={() => setReleasing(true)}>
                  Can't make it in person?
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
                Change my days
              </Button>
            </div>
          )}
        </>
      )}
      {releasing && (
        <ReleaseSeatDialog
          data={data}
          open
          initialDay={focusDay}
          onCancel={() => setReleasing(false)}
          onRelease={(dayAttendance) => {
            setReleasing(false);
            onSave(registrationManageSchema.parse({ action: "update", dayAttendance }).dayAttendance ?? []);
          }}
        />
      )}
    </section>
  );
}
