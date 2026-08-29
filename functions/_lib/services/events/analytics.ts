import type { EventAnalyticsResponse } from "../../../../assets/shared/schemas/event-analytics";
import { eventAnalyticsResponseSchema } from "../../../../assets/shared/schemas/event-analytics";
import { batchFirst, batchRows } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { decodeAttendanceChangeStatistics, decodeAttendanceStatusByType } from "../registrations/attendance-statistics";
import type { EventRecord } from "../event-types";
import { prepareEventAnalyticsStatements } from "./analytics-queries";

interface CountByStatusRow {
  status: string;
  count: number;
}

interface CountByAttendanceTypeRow {
  attendance_type: string;
  count: number;
}

interface RegistrationStatusAndTypeRow extends CountByStatusRow {
  attendance_type: string;
}

interface RegistrationGrowthRow extends CountByAttendanceTypeRow {
  date: string;
}

interface WaitlistByDayRow extends CountByStatusRow {
  day_date: string;
  label: string | null;
  sort_order: number;
  priority_lane: string;
}

interface CountByPriorityLaneRow {
  priority_lane: string;
  count: number;
}

interface RegistrationsByEventDayRow extends CountByAttendanceTypeRow {
  day_date: string;
  label: string | null;
  sort_order: number;
  attendance_status: "accepted" | "waitlisted" | "pending";
}

interface InviteDeclineRow {
  reason_code: string | null;
  count: number;
  unsubscribed: number;
}

interface RsvpStatusRow {
  response_status: string;
  count: number;
}

interface RsvpProviderRow {
  provider: string;
  count: number;
}

interface RsvpActionRow {
  action_taken: string;
  count: number;
}

function countMap<T extends { count: number }>(rows: T[], key: keyof T): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [String(row[key]), Number(row.count)]));
}

/** Event dashboard read model executed as one bounded D1 batch. */
export async function getEventAnalytics(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "slug" | "name">,
  options: { includeProposalStats: boolean },
): Promise<EventAnalyticsResponse> {
  const results = await db.batch(prepareEventAnalyticsStatements(db, event.id, options.includeProposalStats));
  const [
    registrationStatusResult,
    registrationAttendanceResult,
    registrationStatusAndTypeResult,
    growthResult,
    registrationTotalResult,
    sponsorConsentResult,
    waitlistByDayResult,
    waitlistStatusResult,
    waitlistLaneResult,
    registrationsByDayResult,
    inviteAttendeeResult,
    inviteSpeakerResult,
    attendeeDeclineResult,
    speakerDeclineResult,
    proposalStatusResult,
    rsvpStatusResult,
    rsvpProviderResult,
    rsvpActionResult,
    ...sharedAttendanceResults
  ] = results;

  const registrationStatusRows = batchRows<CountByStatusRow>(registrationStatusResult);
  const registrationAttendanceRows = batchRows<CountByAttendanceTypeRow>(registrationAttendanceResult);
  const registrationStatusAndTypeRows = batchRows<RegistrationStatusAndTypeRow>(registrationStatusAndTypeResult);
  const growthByDayRows = batchRows<RegistrationGrowthRow>(growthResult);
  const waitlistByDayRows = batchRows<WaitlistByDayRow>(waitlistByDayResult);
  const waitlistStatusRows = batchRows<CountByStatusRow>(waitlistStatusResult);
  const waitlistLaneRows = batchRows<CountByPriorityLaneRow>(waitlistLaneResult);
  const registrationsByDayRows = batchRows<RegistrationsByEventDayRow>(registrationsByDayResult);
  const inviteAttendeeRows = batchRows<CountByStatusRow>(inviteAttendeeResult);
  const inviteSpeakerRows = batchRows<CountByStatusRow>(inviteSpeakerResult);
  const attendeeDeclineRows = batchRows<InviteDeclineRow>(attendeeDeclineResult);
  const speakerDeclineRows = batchRows<InviteDeclineRow>(speakerDeclineResult);
  const proposalStatusRows = batchRows<CountByStatusRow>(proposalStatusResult);
  const rsvpByStatusRows = batchRows<RsvpStatusRow>(rsvpStatusResult);
  const rsvpByProviderRows = batchRows<RsvpProviderRow>(rsvpProviderResult);
  const rsvpActionsTakenRows = batchRows<RsvpActionRow>(rsvpActionResult);
  const attendanceChanges = decodeAttendanceChangeStatistics(sharedAttendanceResults.slice(0, 4));
  const attendanceStatusByType = decodeAttendanceStatusByType(sharedAttendanceResults[4]);

  const registrationTotal = Number(
    batchFirst<{ count: number }>(registrationTotalResult)?.count ??
      registrationStatusRows.reduce((sum, row) => sum + Number(row.count), 0),
  );
  const sponsorConsentGranted = Number(batchFirst<{ count: number }>(sponsorConsentResult)?.count ?? 0);
  const sponsorConsentNotGranted = Math.max(0, registrationTotal - sponsorConsentGranted);
  const waitlistTotal = waitlistStatusRows.reduce((sum, row) => sum + Number(row.count), 0);
  const attendeeTotal = inviteAttendeeRows.reduce((sum, row) => sum + Number(row.count), 0);
  const speakerTotal = inviteSpeakerRows.reduce((sum, row) => sum + Number(row.count), 0);
  const proposalTotal = proposalStatusRows.reduce((sum, row) => sum + Number(row.count), 0);
  const rsvpTotal = rsvpByStatusRows.reduce((sum, row) => sum + Number(row.count), 0);

  return eventAnalyticsResponseSchema.parse({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: {
      byStatus: countMap(registrationStatusRows, "status"),
      byAttendanceType: countMap(registrationAttendanceRows, "attendance_type"),
      attendanceStatusByType,
      byStatusAndType: registrationStatusAndTypeRows,
      sponsorConsent: { granted: sponsorConsentGranted, notGranted: sponsorConsentNotGranted },
      total: registrationStatusRows.reduce((sum, row) => sum + Number(row.count), 0),
      growthByDay: growthByDayRows,
    },
    waitlistByEventDay: waitlistByDayRows,
    waitlistTotals: {
      total: waitlistTotal,
      byStatus: countMap(waitlistStatusRows, "status"),
      byPriorityLane: countMap(waitlistLaneRows, "priority_lane"),
    },
    attendanceChanges: {
      ...attendanceChanges,
      totalChanges: attendanceChanges.dayChanges,
      changedRegistrations: attendanceChanges.changedAttendees,
    },
    registrationsByEventDay: registrationsByDayRows,
    invites: {
      attendee: {
        byStatus: countMap(inviteAttendeeRows, "status"),
        total: attendeeTotal,
        declineReasons: attendeeDeclineRows,
      },
      speaker: {
        byStatus: countMap(inviteSpeakerRows, "status"),
        total: speakerTotal,
        declineReasons: speakerDeclineRows,
      },
    },
    proposals: options.includeProposalStats
      ? { byStatus: countMap(proposalStatusRows, "status"), total: proposalTotal }
      : null,
    rsvp: {
      byStatus: countMap(rsvpByStatusRows, "response_status"),
      byProvider: countMap(rsvpByProviderRows, "provider"),
      actionsTaken: countMap(rsvpActionsTakenRows, "action_taken"),
      total: rsvpTotal,
    },
  });
}
