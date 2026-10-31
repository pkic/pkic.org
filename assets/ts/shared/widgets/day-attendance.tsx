import { render } from "preact";
import { DayAttendancePicker } from "../../components/DayAttendancePicker";
import type { EventFormsResponse } from "../types";

export type DayAttendanceType = string;

export interface DayAttendanceValue {
  dayDate: string;
  attendanceType: DayAttendanceType;
}

const mountedPickers = new WeakSet<HTMLElement>();

export function renderDayAttendance(container: HTMLElement, days: EventFormsResponse["eventDays"]): void {
  const lowCapacityThreshold = Number(container.dataset.lowCapacityThreshold ?? 0);
  // The server-rendered "Loading event days…" is not Preact's to diff away; clear it before the first render.
  if (!mountedPickers.has(container)) container.textContent = "";
  mountedPickers.add(container);
  render(<DayAttendancePicker days={days} lowCapacityThreshold={lowCapacityThreshold} />, container);
}

/** Read every day in column order, including days intentionally left out. */
export function readDayAttendanceChoices(form: HTMLFormElement) {
  const days = form.querySelectorAll<HTMLInputElement>('input[name^="dayAttendance."][value=""]');
  const selected = Array.from(form.querySelectorAll<HTMLInputElement>('input[name^="dayAttendance."]:checked'));
  return Array.from(days).map((day) => {
    const field = selected.find((field) => field.name === day.name);
    return {
      answered: Boolean(field),
      dayDate: day.name.replace(/^dayAttendance\./, ""),
      dayLabel: day.dataset.dayLabel || day.name.replace(/^dayAttendance\./, ""),
      attendanceType: field?.value || "",
      optionLabel: field?.value ? field.dataset.optionLabel || field.value : "Not attending",
      waitlisted: field?.hasAttribute("data-waitlist") ?? false,
    };
  });
}

export function readDayAttendance(form: HTMLFormElement): DayAttendanceValue[] {
  return readDayAttendanceChoices(form)
    .filter((day) => day.attendanceType !== "")
    .map(({ dayDate, attendanceType }) => ({ dayDate, attendanceType }));
}

export function writeDayAttendance(form: HTMLFormElement, values: DayAttendanceValue[]): void {
  for (const value of values) {
    const field = form.querySelector<HTMLInputElement>(
      `input[name='dayAttendance.${value.dayDate}'][value='${value.attendanceType}']`,
    );
    if (field) {
      if (!field.checked) field.click();
    }
  }
}
