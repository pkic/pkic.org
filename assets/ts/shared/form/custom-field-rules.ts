import type { FormField } from "../types";
import type { AttendanceType } from "../../../shared/schemas/registration";
import {
  isFormFieldVisible,
  parseFormFieldOptions,
  parseFormFieldRules,
  type FormFieldOption,
  type FormFieldRules,
} from "../../../shared/schemas/form-field-rules";

export type FieldOption = FormFieldOption;
export type FieldRules = FormFieldRules;

export function readRules(field: FormField): FieldRules {
  return parseFormFieldRules(field.validation);
}

export function isFieldVisible(
  rules: FieldRules,
  context: {
    dayAttendance: Array<{ attendanceType: string }>;
    eventAttendanceType?: AttendanceType;
  },
): boolean {
  return isFormFieldVisible(rules, {
    dayAttendanceTypes: context.dayAttendance.map((entry) => entry.attendanceType),
    eventAttendanceType: context.eventAttendanceType,
  });
}

export function optionsFor(field: FormField): FieldOption[] {
  return parseFormFieldOptions(field.options).filter((option) => option.active);
}
