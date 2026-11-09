/** The registration day summary and its single attendance editor. */
import { useRef, useState } from "preact/hooks";

import { registrationManageSchema, type RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { useContractForm } from "../../hooks/useContractForm";
import { Button } from "../../ui/Button";
import { DayAttendancePicker, NOT_ATTENDING } from "../DayAttendancePicker";
import { RegistrationDayStatusSummary } from "../RegistrationDayStatusSummary";
import {
  hasLimitedAttendance,
  registrationDays,
  releasedRegistrationDays,
  type RegistrationDayView,
  type RegistrationDayChoices as DayAttendance,
} from "./registration-day-changes";
import { confirmRegistrationDayChanges } from "./confirm-registration-day-changes";
import { PersonalAddressPrompt } from "./PersonalAddressPrompt";
import "./RegistrationDays.css";
import { SectionHeading } from "../../ui/SectionHeading";

function currentType(day: RegistrationDayView): string | null {
  return day.state.kind === "absent" ? null : day.state.attendanceType;
}

function DaysForm({
  data,
  days,
  busy,
  onSave,
  onDiscard,
  focusDay,
}: {
  data: RegistrationManageReadResponse;
  days: RegistrationDayView[];
  busy: boolean;
  onSave: (dayAttendance: DayAttendance) => void;
  onDiscard: () => void;
  focusDay: string | null;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(days.map((day) => [day.dayDate, currentType(day) ?? NOT_ATTENDING])),
  );
  const dayAttendance = days
    .filter((day) => draft[day.dayDate])
    .map((day) => ({ dayDate: day.dayDate, attendanceType: draft[day.dayDate]! }));
  const form = useContractForm(registrationManageSchema, { action: "update", dayAttendance });
  const releasedDays = releasedRegistrationDays(data, dayAttendance);
  const joining = days.some(
    (day) => draft[day.dayDate] !== currentType(day) && hasLimitedAttendance(data, day.dayDate, draft[day.dayDate]),
  );

  const confirming = useRef(false);

  async function save() {
    if (busy || confirming.current) return;
    const checked = form.submit();
    if (!checked.data) return;
    confirming.current = true;
    try {
      if (!(await confirmRegistrationDayChanges(data, dayAttendance))) return;
      // The caller confirms cancellation when no days remain.
      onSave(checked.data.dayAttendance ?? []);
    } finally {
      confirming.current = false;
    }
  }

  return (
    <form
      class="pk-reg-days__form"
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DayAttendancePicker
        days={data.eventDays}
        focusDay={focusDay}
        value={draft}
        onChange={(dayDate, attendanceType) => setDraft((current) => ({ ...current, [dayDate]: attendanceType }))}
      />
      {joining && (
        <p class="pk-small">
          Some options have limited places. If your choice is full, you join its waiting list and we email you when a
          place is available.
        </p>
      )}
      {releasedDays.length > 0 && (
        <p class="pk-small">
          Your place may go to the next person on the waiting list as soon as you save. If you change your mind later,
          you join the waiting list again.
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
  /** Opens the picker and focuses this day for an attendance email link. */
  focusDay?: string | null;
}) {
  const [editing, setEditing] = useState(Boolean(focusDay) && editable);
  const days = registrationDays(data);
  if (days.length === 0) return null;

  return (
    <section class="pk-reg-days" aria-label="Your days">
      <SectionHeading level={3} class="pk-reg-days__title">
        Your days
      </SectionHeading>
      {editing ? (
        <DaysForm
          data={data}
          days={days}
          busy={busy}
          focusDay={focusDay}
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
            cancelled={data.registration.status === "cancelled"}
            onClaim={editable ? onClaim : undefined}
          />
          {data.dayWaitlist.some((entry) => entry.status === "waiting") && (
            <PersonalAddressPrompt withoutWorkAddress={data.waitlistHandledLast} waiting />
          )}
          {editable && (
            <div class="pk-cluster">
              <Button disabled={busy} onClick={() => setEditing(true)}>
                Change my days
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
