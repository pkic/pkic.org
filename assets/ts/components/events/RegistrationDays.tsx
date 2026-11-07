/**
 * One attendance picker for the registration summary and its explicit editor.
 * Opening editing preserves the saved choices; only Save submits a change.
 * Existing release links retain their guided seat-release dialog.
 */
import { useEffect, useRef, useState } from "preact/hooks";

import { registrationManageSchema, type RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { useContractForm } from "../../hooks/useContractForm";
import { Button } from "../../ui/Button";
import { DayAttendancePicker, NOT_ATTENDING, ATTENDANCE_EDIT_LABEL } from "../DayAttendancePicker";
import { RegistrationDayStatusSummary } from "../RegistrationDayStatusSummary";
import { registrationDays, type RegistrationDayView } from "./registration-day-changes";
import { ReleaseSeatDialog, releasableDays } from "./ReleaseSeatDialog";
import { PersonalAddressPrompt } from "./PersonalAddressPrompt";
import "./RegistrationDays.css";
import { SectionHeading } from "../../ui/SectionHeading";
import { IconPencil } from "../icons";

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
  onSave: (dayAttendance: DayAttendance) => Promise<boolean>;
  onDiscard: () => void;
}) {
  const submitting = useRef(false);
  const formElement = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formElement.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }, []);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(days.map((day) => [day.dayDate, currentType(day) ?? NOT_ATTENDING])),
  );
  const dayAttendance = days
    .filter((day) => draft[day.dayDate])
    .map((day) => ({ dayDate: day.dayDate, attendanceType: draft[day.dayDate]! }));
  const form = useContractForm(registrationManageSchema, { action: "update", dayAttendance });
  // Only a confirmed seat is released; a day still waiting holds none.
  const hasLimit = (dayDate: string, value: string | null | undefined) => {
    const option = data.eventDays
      .find((day) => day.dayDate === dayDate)
      ?.attendanceOptions.find((item) => item.value === value);
    return option?.spotsRemainingPercent != null;
  };
  const releasing = days.some(
    (day) =>
      day.state.kind === "attending" &&
      draft[day.dayDate] !== currentType(day) &&
      hasLimit(day.dayDate, currentType(day)),
  );
  const joining = days.some(
    (day) => draft[day.dayDate] !== currentType(day) && hasLimit(day.dayDate, draft[day.dayDate]),
  );

  return (
    <form
      class="pk-reg-days__form"
      ref={formElement}
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || submitting.current) return;
        const checked = form.submit();
        if (!checked.data) return;
        // No day left is not a day change: the caller treats it as cancelling.
        submitting.current = true;
        void onSave(checked.data.dayAttendance ?? []).finally(() => {
          submitting.current = false;
        });
      }}
    >
      <div inert={busy}>
        <DayAttendancePicker
          days={data.eventDays}
          value={draft}
          onChange={(dayDate, attendanceType) => setDraft((current) => ({ ...current, [dayDate]: attendanceType }))}
        />
      </div>
      {joining && (
        <p class="pk-small">
          Some options have limited places. If your choice is full, you join its waiting list and we email you when a
          place is available.
        </p>
      )}
      {releasing && (
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
  onSave: (dayAttendance: DayAttendance) => Promise<boolean>;
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
      <div class="pk-cluster pk-cluster--nowrap">
        <SectionHeading level={3} class="pk-reg-days__title">
          {editing ? ATTENDANCE_EDIT_LABEL : "Your days"}
        </SectionHeading>
        {editable && !editing && (
          <Button
            variant="ghost"
            icon
            aria-label={ATTENDANCE_EDIT_LABEL}
            title={ATTENDANCE_EDIT_LABEL}
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <IconPencil />
          </Button>
        )}
      </div>
      {editing ? (
        <DaysForm
          data={data}
          days={days}
          busy={busy}
          onSave={async (dayAttendance) => {
            const saved = await onSave(dayAttendance);
            if (saved) setEditing(false);
            return saved;
          }}
          onDiscard={() => setEditing(false)}
        />
      ) : (
        <>
          {data.registration.status === "registered" && !data.dayWaitlist.some((day) => day.status === "offered") ? (
            <DayAttendancePicker
              days={data.eventDays}
              readOnly
              onEdit={editable && !busy ? () => setEditing(true) : undefined}
              value={Object.fromEntries(data.dayAttendance.map((day) => [day.dayDate, day.attendanceType]))}
              waitlist={Object.fromEntries(data.dayWaitlist.map((day) => [day.dayDate, day.status]))}
            />
          ) : (
            <RegistrationDayStatusSummary
              dayAttendance={data.dayAttendance}
              dayWaitlist={data.dayWaitlist}
              busy={busy}
              cancelled={data.registration.status === "cancelled"}
              onClaim={editable ? onClaim : undefined}
            />
          )}

          {data.dayWaitlist.some((entry) => entry.status === "waiting") && (
            <PersonalAddressPrompt withoutWorkAddress={data.waitlistHandledLast} waiting />
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
            void onSave(registrationManageSchema.parse({ action: "update", dayAttendance }).dayAttendance ?? []);
          }}
        />
      )}
    </section>
  );
}
