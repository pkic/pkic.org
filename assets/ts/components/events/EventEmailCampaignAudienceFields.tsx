import { useState } from "preact/hooks";
import type { FieldPresentation } from "../../hooks/useContractForm";
import {
  eventEmailCampaignAudienceSchema,
  eventEmailCampaignDayWaitlistFilterSchema,
  eventEmailCampaignSpeakerStatusFilterSchema,
  isInvitationCampaignAudience,
  type EventEmailCampaignAudience,
  type EventEmailCampaignDayWaitlistFilter,
  type EventEmailCampaignInvitationStatusFilter,
  type EventEmailCampaignSpeakerStatusFilter,
} from "../../../shared/schemas/event-email-campaigns";
import {
  EVENT_REGISTRATION_STATUS_FILTERS,
  eventRegistrationStatusFilterSchema,
  eventRegistrationStatusLabel,
  type EventRegistrationStatusFilter,
} from "../../../shared/schemas/event-registrations";
import { Field } from "../../ui/Field";
import { Select } from "../../ui/TextControl";
import { EventInvitationStatusFilter } from "./EventInvitationStatusFilter";
import {
  AUDIENCE_LABELS,
  DAY_WAITLIST_FILTER_LABELS,
  SPEAKER_STATUS_FILTER_LABELS,
  type CampaignPayload,
  useDays,
} from "./event-email-campaign-support";

/** Who a campaign reaches, held apart from what the message says. */
export function useCampaignAudience(
  daysPath: string,
  initialAudience: EventEmailCampaignAudience,
  initialSpeakerStatus: EventEmailCampaignSpeakerStatusFilter,
) {
  const days = useDays(daysPath);
  const [audience, setAudience] = useState(initialAudience);
  const [attendeeStatus, setAttendeeStatus] = useState<EventRegistrationStatusFilter>("registered");
  const [attendanceType, setAttendanceType] = useState("all");
  const [dayFilter, setDayFilter] = useState("");
  const [dayWaitlistStatus, setDayWaitlistStatus] = useState<EventEmailCampaignDayWaitlistFilter>("all");
  const [speakerStatus, setSpeakerStatus] = useState(initialSpeakerStatus);
  const [invitationStatus, setInvitationStatus] = useState<EventEmailCampaignInvitationStatusFilter>("all");

  const filter: CampaignPayload["filter"] = { audience };
  if (audience === "attendees") {
    filter.attendeeStatus = attendeeStatus as CampaignPayload["filter"]["attendeeStatus"];
    filter.attendanceType = attendanceType as CampaignPayload["filter"]["attendanceType"];
    if (dayFilter) filter.dayDate = dayFilter;
    filter.dayWaitlistStatus = dayWaitlistStatus;
  } else if (audience === "speakers") {
    filter.speakerStatus = speakerStatus;
    if (dayFilter) filter.dayDate = dayFilter;
  } else if (isInvitationCampaignAudience(audience)) {
    filter.invitationStatus = invitationStatus;
  }

  return {
    days,
    filter,
    audience,
    setAudience,
    attendeeStatus,
    setAttendeeStatus,
    attendanceType,
    setAttendanceType,
    dayFilter,
    setDayFilter,
    dayWaitlistStatus,
    setDayWaitlistStatus,
    speakerStatus,
    setSpeakerStatus,
    invitationStatus,
    setInvitationStatus,
  };
}

export function EventEmailCampaignAudienceFields({
  selection,
  audienceField,
  invitationField,
}: {
  selection: ReturnType<typeof useCampaignAudience>;
  audienceField: FieldPresentation;
  invitationField: FieldPresentation;
}) {
  const {
    days,
    audience,
    setAudience,
    attendeeStatus,
    setAttendeeStatus,
    attendanceType,
    setAttendanceType,
    dayFilter,
    setDayFilter,
    dayWaitlistStatus,
    setDayWaitlistStatus,
    speakerStatus,
    setSpeakerStatus,
    invitationStatus,
    setInvitationStatus,
  } = selection;

  const dayField = (
    <Field label="Specific day">
      {(control) => (
        <Select {...control} value={dayFilter} onChange={(e) => setDayFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All days</option>
          {days.map((d) => {
            const dateKey = d.day_date ?? d.date ?? "";
            return (
              <option key={dateKey} value={dateKey}>
                {d.label ?? dateKey}
              </option>
            );
          })}
        </Select>
      )}
    </Field>
  );

  return (
    <div class="pk-grid" aria-label="Audience and filters">
      <Field label="Audience" {...audienceField}>
        {(control) => (
          <Select
            {...control}
            name="filter.audience"
            value={audience}
            onChange={(event) =>
              setAudience(eventEmailCampaignAudienceSchema.parse((event.target as HTMLSelectElement).value))
            }
          >
            {eventEmailCampaignAudienceSchema.options.map((option) => (
              <option key={option} value={option}>
                {AUDIENCE_LABELS[option]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {isInvitationCampaignAudience(audience) ? (
        <EventInvitationStatusFilter value={invitationStatus} onChange={setInvitationStatus} field={invitationField} />
      ) : audience === "attendees" ? (
        <>
          <Field label="Registration status">
            {(control) => (
              <Select
                {...control}
                value={attendeeStatus}
                onChange={(e) =>
                  setAttendeeStatus(eventRegistrationStatusFilterSchema.parse((e.target as HTMLSelectElement).value))
                }
              >
                {EVENT_REGISTRATION_STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? "All" : eventRegistrationStatusLabel(status)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Attendance type">
            {(control) => (
              <Select
                {...control}
                value={attendanceType}
                onChange={(e) => setAttendanceType((e.target as HTMLSelectElement).value)}
              >
                <option value="all">All types</option>
                <option value="in_person">In-person</option>
                <option value="virtual">Virtual</option>
                <option value="on_demand">On-demand</option>
              </Select>
            )}
          </Field>
          {dayField}
          <Field label="Day waitlist">
            {(control) => (
              <Select
                {...control}
                value={dayWaitlistStatus}
                onChange={(e) =>
                  setDayWaitlistStatus(
                    eventEmailCampaignDayWaitlistFilterSchema.parse((e.target as HTMLSelectElement).value),
                  )
                }
              >
                {eventEmailCampaignDayWaitlistFilterSchema.options.map((waitlistStatus) => (
                  <option key={waitlistStatus} value={waitlistStatus}>
                    {DAY_WAITLIST_FILTER_LABELS[waitlistStatus]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      ) : (
        <>
          <Field label="Speaker status">
            {(control) => (
              <Select
                {...control}
                value={speakerStatus}
                onChange={(e) =>
                  setSpeakerStatus(
                    eventEmailCampaignSpeakerStatusFilterSchema.parse((e.target as HTMLSelectElement).value),
                  )
                }
              >
                {/* Reading the contract's order puts "All active" at the head
                    of the list where the hand-written version led with
                    "Confirmed"; the composer still opens on confirmed
                    speakers, because that is what the state starts as. */}
                {eventEmailCampaignSpeakerStatusFilterSchema.options.map((status) => (
                  <option key={status} value={status}>
                    {SPEAKER_STATUS_FILTER_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {dayField}
        </>
      )}
    </div>
  );
}
