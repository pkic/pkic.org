import { render } from "preact";
import { DayAttendancePicker } from "../../components/DayAttendancePicker";
import type { EventFormsResponse } from "../types";

export type DayAttendanceType = string;

export interface DayAttendanceValue {
  dayDate: string;
  attendanceType: DayAttendanceType;
}

export function renderDayAttendance(container: HTMLElement, days: EventFormsResponse["eventDays"]): void {
  const lowCapacityThreshold = Number(container.dataset.lowCapacityThreshold ?? 0);
  render(<DayAttendancePicker days={days} lowCapacityThreshold={lowCapacityThreshold} />, container);
}

export function readDayAttendance(form: HTMLFormElement): DayAttendanceValue[] {
  const fields = form.querySelectorAll<HTMLInputElement>("input[name^='dayAttendance.']:checked");
  return Array.from(fields).map((field) => ({
    dayDate: field.name.replace(/^dayAttendance\./, ""),
    attendanceType: field.value,
  }));
}

export function writeDayAttendance(form: HTMLFormElement, values: DayAttendanceValue[]): void {
  for (const value of values) {
    const field = form.querySelector<HTMLInputElement>(
      `input[name='dayAttendance.${value.dayDate}'][value='${value.attendanceType}']`,
    );
    if (field) {
      field.checked = true;
    }
  }
}
