import type { EventDayCapacityGuardPlan } from "./day-waitlist-capacity";
import type { RegistrationRecord } from "./types";
import {
  SPEAKER_ATTENDANCE_PREFERENCE,
  type EventParticipantRole,
} from "../../../../assets/shared/schemas/participant-roles";
import {
  deriveEventAttendanceType,
  getRegistrationDayAttendance,
  listEventDays,
  resolveAttendanceOptions,
} from "../event-days";
import { buildCreateRegistration } from "./create";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLog } from "../audit";
import { nowIso } from "../../utils/time";

/** Creates an organizer-admitted speaker registration inside the decision transaction. */
export async function prepareProposalAdmission(
  db: DatabaseLike,
  input: {
    previousRegistration?: RegistrationRecord;
    eventId: string;
    userId: string;
    activeProposalRoles: readonly EventParticipantRole[];
    sharedCapacityGuards?: EventDayCapacityGuardPlan;
  },
): Promise<StatementLike[]> {
  const days = await listEventDays(db, input.eventId);
  const selections = days.flatMap((day) => {
    const options = resolveAttendanceOptions(day);
    const option =
      SPEAKER_ATTENDANCE_PREFERENCE.map((value) => options.find((option) => option.value === value)).find(Boolean) ??
      options[0];
    return option ? [{ dayDate: day.day_date, attendanceType: option.value }] : [];
  });
  const previous = input.previousRegistration;
  const priorDays = previous ? await getRegistrationDayAttendance(db, previous.id) : [];
  const dayAttendance = previous ? priorDays : selections;
  const built = await buildCreateRegistration(db, {
    event: { id: input.eventId },
    userId: input.userId,
    attendanceType:
      deriveEventAttendanceType(dayAttendance) ?? previous?.attendance_type ?? SPEAKER_ATTENDANCE_PREFERENCE[0],
    dayAttendance,
    customAnswersJson: previous?.custom_answers_json,
    formPlacementId: previous?.form_placement_id,
    eventOrganizationName: previous?.registration_organization_name,
    eventJobTitle: previous?.registration_job_title,
    sourceType: previous?.source_type ?? "proposal",
    sourceRef: previous?.source_ref,
    inviteId: previous?.invite_id,
    acceptedProposalRoles: input.activeProposalRoles,
    sharedCapacityGuards: input.sharedCapacityGuards,
  });
  return [
    ...built.statements,
    prepareAuditLog(
      db,
      "system",
      null,
      "speaker_registration_created",
      "registration",
      built.registration.id,
      { eventId: input.eventId, reactivated: built.reactivated },
      nowIso(),
    ),
  ];
}
