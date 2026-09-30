import { ApiDataTable } from "../ApiDataTable";
import { Badge } from "../Badge";
import {
  EVENT_SPEAKER_REGISTRATION_FILTER_LABELS,
  eventSpeakerRegistrationFilterSchema,
  eventSpeakersResponseSchema,
  type EventProposalSpeaker,
} from "../../../shared/schemas/event-speakers";
import { RegistrationDayStates } from "../event-registrations/RegistrationDayStates";

function speakerName(speaker: EventProposalSpeaker): string {
  return [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || "Unnamed speaker";
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
          header: "Speaker",
          cell: speakerName,
          width: "fit",
          sort: { asc: "speaker", desc: "-speaker", defaultDirection: "asc" },
        },
        { header: "Organization", cell: (speaker) => speaker.organizationName || "—" },
        {
          header: "Talk",
          cell: (speaker) => <span title={speaker.proposalTitle}>{speaker.proposalTitle}</span>,
          width: "primary",
          sort: { asc: "proposal", desc: "-proposal", defaultDirection: "asc" },
        },
        { header: "Participation", cell: (speaker) => <Badge status={speaker.status} />, width: "fit" },
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
        { header: "Days", cell: selectedDays },
      ]}
      empty="No proposal speakers found"
      rowKey={(speaker) => speaker.id}
      rowAction={(speaker) => ({ label: `Open ${speaker.proposalTitle}`, href: rowHref(speaker) })}
    />
  );
}
