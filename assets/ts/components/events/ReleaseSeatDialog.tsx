/**
 * "Can't make it in person?" as a guided decision rather than a form: which
 * in-person days to give up, then how to join on those days instead. The
 * confirmation names what happens — the seats go to the waiting list — and
 * only then sends one update.
 */
import { useState } from "preact/hooks";

import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { formatDayList } from "../../../shared/format-date";
import { formatNumber } from "../../../shared/format-number";
import { Checkbox, Radio } from "../../ui/Checkbox";
import { Dialog } from "../../ui/Dialog";
import { IN_PERSON } from "./registration-day-changes";

type DayAttendance = Array<{ dayDate: string; attendanceType: string }>;

const NOT_ATTENDING = "";

/** The confirmed in-person days: the seats this dialog can release. */
export function releasableDays(data: RegistrationManageReadResponse): string[] {
  const pending = new Set(
    data.dayWaitlist.filter((entry) => entry.status === "waiting" || entry.status === "offered").map((e) => e.dayDate),
  );
  return data.dayAttendance
    .filter((entry) => entry.attendanceType === IN_PERSON && !pending.has(entry.dayDate))
    .map((entry) => entry.dayDate)
    .sort();
}

/** Ways of joining every chosen day offers, other than in person. */
function alternatives(data: RegistrationManageReadResponse, dayDates: string[]) {
  const options = dayDates.map(
    (dayDate) => data.eventDays.find((day) => day.dayDate === dayDate)?.attendanceOptions ?? [],
  );
  const [first = [], ...rest] = options;
  return first.filter(
    (option) => option.value !== IN_PERSON && rest.every((other) => other.some((o) => o.value === option.value)),
  );
}

export function ReleaseSeatDialog({
  data,
  open,
  initialDay,
  onRelease,
  onCancel,
}: {
  data: RegistrationManageReadResponse;
  open: boolean;
  /** A day to start with selected, when a link asked about it. */
  initialDay: string | null;
  onRelease: (dayAttendance: DayAttendance) => void;
  onCancel: () => void;
}) {
  const days = releasableDays(data);
  const [chosen, setChosen] = useState<string[]>(() =>
    initialDay && days.includes(initialDay) ? [initialDay] : days.length === 1 ? days : [],
  );
  const [instead, setInstead] = useState<string | null>(null);
  const choices = chosen.length ? alternatives(data, chosen) : [];
  const seats = chosen.length === 1 ? "my seat" : `${formatNumber(chosen.length)} seats`;

  return (
    <Dialog
      open={open}
      title="Can't make it in person?"
      description="Thank you for letting us know. Your seat goes to the next person on the waiting list."
      confirmLabel={chosen.length ? `Release ${seats}` : "Release my seat"}
      cancelLabel="Keep my seats"
      confirmDisabled={chosen.length === 0 || instead === null}
      onCancel={onCancel}
      onConfirm={() => {
        const next = data.dayAttendance
          .filter((entry) => !chosen.includes(entry.dayDate) || instead !== NOT_ATTENDING)
          .map(({ dayDate, attendanceType }) => ({
            dayDate,
            attendanceType: chosen.includes(dayDate) ? instead! : attendanceType,
          }));
        onRelease(next);
      }}
    >
      <div class="pk-stack">
        {days.length > 1 && (
          <fieldset class="pk-fieldset pk-stack pk-stack--snug">
            <legend class="pk-strong">Which days can't you attend in person?</legend>
            {days.map((dayDate) => (
              <Checkbox
                key={dayDate}
                name="releaseDay"
                value={dayDate}
                label={formatDayList([dayDate])}
                checked={chosen.includes(dayDate)}
                onChange={() =>
                  setChosen(
                    chosen.includes(dayDate) ? chosen.filter((d) => d !== dayDate) : [...chosen, dayDate].sort(),
                  )
                }
              />
            ))}
          </fieldset>
        )}
        {chosen.length > 0 && (
          <fieldset class="pk-fieldset pk-stack pk-stack--snug">
            <legend class="pk-strong">
              How would you like to join on {days.length > 1 ? "those days" : formatDayList(chosen)} instead?
            </legend>
            {choices.map((option) => (
              <Radio
                key={option.value}
                name="joinInstead"
                value={option.value}
                label={option.label}
                checked={instead === option.value}
                onChange={() => setInstead(option.value)}
              />
            ))}
            <Radio
              name="joinInstead"
              value={NOT_ATTENDING}
              label={chosen.length > 1 ? "I won't attend those days" : "I won't attend that day"}
              checked={instead === NOT_ATTENDING}
              onChange={() => setInstead(NOT_ATTENDING)}
            />
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
