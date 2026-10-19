import { ApiDataTable } from "../ApiDataTable";
import { SpeakerParticipationBadge } from "./SpeakerParticipationBadge";
import { Badge } from "../Badge";
import {
  EVENT_SPEAKER_REGISTRATION_FILTER_LABELS,
  eventSpeakerRegistrationFilterSchema,
  eventSpeakersResponseSchema,
  type EventProposalSpeaker,
} from "../../../shared/schemas/event-speakers";
import { RegistrationDayStates } from "../event-registrations/RegistrationDayStates";
import { IndependentCapacityBadge } from "./IndependentCapacityReview";
import { PersonCell } from "../../ui/PersonCell";

/** The speaker's name, or the address they were invited at while they have not given one. */
function speakerName(speaker: EventProposalSpeaker): string {
  return [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
}

function selectedDays(speaker: EventProposalSpeaker) {
  if (speaker.registrationStatus !== "registered") return "—";
  return <RegistrationDayStates days={speaker.days} attendanceType={speaker.attendanceType} />;
}

/** Event-wide roster, with one row per talk speaker and a live registration filter. */
export function EventProposalSpeakersTable({
  slug,
  rowHref,
}: {
  slug: string;
  rowHref: (speaker: EventProposalSpeaker) => string;
}) {
  return (
    <ApiDataTable
      caption="Proposal speakers"
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/speakers`}
      responseSchema={eventSpeakersResponseSchema}
      resolve={(response) => response.speakers}
      resolvePage={(response) => response.page}
      urlState="proposalSpeakers"
      paginate
      initialSort="speaker"
      searchPlaceholder="Search speaker, organization or talk"
      columns={[
        {
          // A person, drawn the way every roster draws one: face, then name.
          header: "Speaker",
          // A capped name leaves the talk, the row's longest value, its width.
          width: "compact",
          cell: (speaker) => (
            <PersonCell
              name={speakerName(speaker)}
              organization={speaker.organizationName}
              avatarSrc={speaker.headshotUrl ?? undefined}
              size="sm"
            />
          ),
          sort: { asc: "speaker", desc: "-speaker", defaultDirection: "asc" },
        },
        {
          // The talk is the row's longest value, so it takes the slack.
          header: "Talk",
          cell: (speaker) => (
            <span class="pk-table__wrap" title={speaker.proposalTitle}>
              {speaker.proposalTitle}
            </span>
          ),
          width: "primary",
          sort: { asc: "proposal", desc: "-proposal", defaultDirection: "asc" },
        },
        {
          header: "Organization",
          cell: (speaker) =>
            speaker.independentCapacityStatus ? (
              <IndependentCapacityBadge status={speaker.independentCapacityStatus} />
            ) : (
              speaker.organizationName || "—"
            ),
        },
        {
          header: "Participation",
          cell: (speaker) => <SpeakerParticipationBadge status={speaker.status} />,
          width: "fit",
        },
        {
          header: "Registration",
          cell: (speaker) =>
            speaker.registrationStatus ? (
              <Badge status={speaker.registrationStatus} />
            ) : (
              <Badge status="not_registered" />
            ),
          width: "fit",
          sort: { asc: "registration", desc: "-registration" },
          filter: {
            param: "registration",
            options: [
              { value: "", label: "All registration statuses" },
              ...eventSpeakerRegistrationFilterSchema.options.map((value) => ({
                value,
                label: EVENT_SPEAKER_REGISTRATION_FILTER_LABELS[value],
              })),
            ],
          },
        },
        { header: "Attendance", cell: selectedDays },
      ]}
      empty="No proposal speakers found"
      rowKey={(speaker) => speaker.id}
      rowAction={(speaker) => ({ label: `Open ${speaker.proposalTitle}`, href: rowHref(speaker) })}
    />
  );
}
