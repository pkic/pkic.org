import type { GroupEventSeries } from "../../../../../shared/schemas/event-series";
import type { MeetingSeriesDraft } from "./MeetingSeriesFields";
import { localDateTimeValue } from "./meeting-form-utils";
import { instantFromLocal } from "../../../../components/forms/SubmissionWindowFields";

export function draftFromSeries(series: GroupEventSeries): MeetingSeriesDraft {
  return {
    name: series.eventName,
    profileKey: series.profileKey,
    startsAt: localDateTimeValue(series.startsAt, series.timezone),
    recurrenceRule: series.recurrenceRule,
    timezone: series.timezone,
    durationMinutes: series.durationMinutes,
    location: series.location ?? "",
    providerJoinUrl: "",
    registrationPolicy: series.registrationPolicy,
    visibility: series.visibility,
    memberEligibility: series.memberEligibility ?? "owner_group",
    guestPolicy: series.guestPolicy ?? "none",
    meetingEntryPolicy: series.meetingEntryPolicy,
  };
}

export function seriesChanges(
  series: GroupEventSeries,
  draft: MeetingSeriesDraft,
  active: boolean,
): Record<string, unknown> {
  const changes: Record<string, unknown> = { expectedUpdatedAt: series.updatedAt };
  if (draft.name !== series.eventName) changes.eventName = draft.name;
  if (draft.profileKey !== series.profileKey) changes.profileKey = draft.profileKey;
  if (series.occurrenceCount === 0) {
    const startsAt = instantFromLocal(draft.startsAt, draft.timezone);
    if (startsAt !== series.startsAt) changes.startsAt = startsAt;
    if (draft.recurrenceRule !== series.recurrenceRule) changes.recurrenceRule = draft.recurrenceRule;
    if (draft.timezone !== series.timezone) changes.timezone = draft.timezone;
    if (draft.durationMinutes !== series.durationMinutes) changes.durationMinutes = draft.durationMinutes;
  }
  const location = draft.location.trim() || null;
  if (location !== series.location) changes.location = location;
  if (draft.providerJoinUrl.trim()) changes.providerJoinUrl = draft.providerJoinUrl.trim();
  if (
    draft.registrationPolicy !== series.registrationPolicy ||
    draft.visibility !== series.visibility ||
    draft.memberEligibility !== (series.memberEligibility ?? "owner_group") ||
    draft.guestPolicy !== (series.guestPolicy ?? "none") ||
    draft.meetingEntryPolicy.authentication !== series.meetingEntryPolicy.authentication ||
    draft.meetingEntryPolicy.rememberDays !== series.meetingEntryPolicy.rememberDays
  ) {
    changes.policy = {
      registrationPolicy: draft.registrationPolicy,
      visibility: draft.visibility,
      memberEligibility: draft.memberEligibility,
      guestPolicy: draft.guestPolicy,
      meetingEntryPolicy: draft.meetingEntryPolicy,
    };
  }
  if (active !== series.active) changes.active = active;
  return changes;
}
