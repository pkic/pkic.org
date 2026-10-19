import { AppError } from "../../errors";
import {
  getActiveFormForEvent,
  getActiveFormForResolution,
  type ActiveFormDefinition,
  type EventFormResolutionEvent,
  type EventFormResolution,
  type FormPurpose,
} from "./read";
import { deriveEventAttendanceType, type DayAttendanceSelection } from "../event-days";
import type { DatabaseLike } from "../../types";
import type { AttendanceType } from "../../../../assets/shared/schemas/registration";
import { isIdentityOwnedFormKey } from "../../../../assets/shared/schemas/form-answers";
import { formAnswersContract } from "../../../../assets/shared/schemas/form-answer-contract";
import type { CustomAnswerValue } from "../../../../assets/shared/form-answer-rules";

export type { CustomAnswerValue, DateRangeAnswer } from "../../../../assets/shared/form-answer-rules";

export interface ValidationContext {
  attendanceType?: AttendanceType;
  dayAttendance?: DayAttendanceSelection[];
}

export interface ValidatedCustomAnswers {
  answers: Record<string, CustomAnswerValue>;
  form: ActiveFormDefinition | null;
}

/**
 * Event-flow callers must either provide the canonical event source mode or
 * explicitly declare a narrow compatibility resolver. This prevents a new
 * portal path from silently inheriting the legacy installation fallback.
 */
export type EventFormValidationTarget =
  | { event: EventFormResolutionEvent; eventId?: never; resolution?: never }
  | { event?: never; eventId: string; resolution: EventFormResolution };

type EventFormValidationPayload = {
  purpose: FormPurpose;
  customAnswers?: Record<string, unknown>;
  context?: ValidationContext;
};

function addFieldError(errors: Record<string, string[]>, key: string, message: string): void {
  if (!errors[key]) {
    errors[key] = [];
  }
  errors[key].push(message);
}

/**
 * Canonical validation/normalization for any portal-managed form. Callers
 * resolve the appropriate form (event-scoped or global); the answers pass the
 * same generated answer contract the respondent's browser validates with, so
 * required, visibility, type, option, and format rules cannot drift between
 * APIs or between the browser and the server.
 */
export function validateCustomAnswersAgainstForm(
  form: ActiveFormDefinition,
  payload: {
    customAnswers?: Record<string, unknown>;
    context?: ValidationContext;
    errorStatus?: number;
  },
): Record<string, CustomAnswerValue> {
  const answers = payload.customAnswers ?? {};
  const fieldErrors: Record<string, string[]> = {};
  const known = new Set(form.fields.map((field) => field.key));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) addFieldError(fieldErrors, key, "Unknown field for this form");
  }

  // A legacy field under an identity-owned key is never asked, except on the
  // membership application, whose answers create the applicant's identity.
  const asked = form.fields.filter((field) => form.purpose === "application" || !isIdentityOwnedFormKey(field.key));
  const context = payload.context ?? {};
  const checked = formAnswersContract(asked, {
    dayAttendanceTypes: context.dayAttendance?.map((entry) => entry.attendanceType),
    eventAttendanceType: context.attendanceType ?? deriveEventAttendanceType(context.dayAttendance) ?? undefined,
  }).safeParse(answers);
  if (!checked.success) {
    for (const issue of checked.error.issues) addFieldError(fieldErrors, String(issue.path[0] ?? ""), issue.message);
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(payload.errorStatus ?? 400, "VALIDATION_ERROR", "Answer the highlighted questions.", {
      fieldErrors,
    });
  }

  return checked.success ? checked.data : {};
}

export async function validateCustomAnswersForSubmission(
  db: DatabaseLike,
  payload: EventFormValidationPayload & EventFormValidationTarget,
): Promise<ValidatedCustomAnswers> {
  const form = await (payload.event
    ? getActiveFormForEvent(db, payload.event, payload.purpose)
    : getActiveFormForResolution(db, payload.eventId, payload.purpose, payload.resolution));

  if (!form) {
    if (Object.keys(payload.customAnswers ?? {}).length > 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Custom answers are not configured for this form", {
        fieldErrors: { customAnswers: ["No active form configured for this event flow"] },
      });
    }
    return { answers: {}, form: null };
  }

  return {
    answers: validateCustomAnswersAgainstForm(form, payload),
    form,
  };
}

export async function validateCustomAnswersByPurpose(
  db: DatabaseLike,
  payload: EventFormValidationPayload & EventFormValidationTarget,
): Promise<Record<string, CustomAnswerValue>> {
  return (await validateCustomAnswersForSubmission(db, payload)).answers;
}
