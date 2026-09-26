/**
 * Who was invited to a meeting occurrence, and what their calendars answered.
 *
 * An invitation is a calendar entry as well as a link (#126): the accept or
 * decline the recipient's calendar sends back lands here, against the
 * person, so a manager can see who is coming without asking around. The
 * list is read from the invitations actually sent — by a round or by the
 * automatic pass — rather than from the roster, because the question is who
 * was told, not who is in the group today.
 */
import { type EventOccurrence } from "../../../../../shared/schemas/event-series";
import {
  eventOccurrenceInvitationResponseFilterSchema,
  eventOccurrenceInvitationsListResponseSchema,
  type EventOccurrenceInvitation,
} from "../../../../../shared/schemas/meeting-invitations";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../ui/Badge";
import { PersonCell } from "../../../../ui/PersonCell";
import { fmt } from "../../ui";

const RESPONSE_LABELS: Record<NonNullable<EventOccurrenceInvitation["response"]>, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
  bounced: "Bounced",
};

const RESPONSE_TONES: Record<NonNullable<EventOccurrenceInvitation["response"]>, "ok" | "danger" | "warn"> = {
  accepted: "ok",
  declined: "danger",
  tentative: "warn",
  bounced: "danger",
};

export function MeetingInvitations({ endpoint, occurrence }: { endpoint: string; occurrence: EventOccurrence }) {
  return (
    <ApiDataTable
      caption="Meeting invitations"
      // Keyed on the round so a round sent from the header re-reads the list.
      key={occurrence.invitationsRound}
      endpoint={`${endpoint}/invitations`}
      responseSchema={eventOccurrenceInvitationsListResponseSchema}
      resolve={(response) => response.invitations}
      resolvePage={(response) => response.page}
      paginate
      searchPlaceholder="Search invitations…"
      initialSort="name"
      columns={[
        {
          header: "Participant",
          cell: (invitation) => (
            <PersonCell
              name={invitation.name}
              email={invitation.name === invitation.email ? undefined : invitation.email}
              size="sm"
            />
          ),
          width: "primary",
          sort: { asc: "name", desc: "-name" },
        },
        {
          header: "Invited",
          cell: (invitation) => fmt(invitation.sentAt),
          width: "fit",
          sort: { asc: "sent_at", desc: "-sent_at" },
        },
        {
          // What the calendar answered, in words: the tone alone says nothing
          // to a reader who cannot see it, and "No answer" is a state worth
          // reading rather than an absence.
          header: "Response",
          cell: (invitation) =>
            invitation.response ? (
              <Badge tone={RESPONSE_TONES[invitation.response]}>{RESPONSE_LABELS[invitation.response]}</Badge>
            ) : (
              <Badge tone="neutral">No answer</Badge>
            ),
          width: "fit",
          sort: { asc: "response", desc: "-response" },
          filter: {
            param: "response",
            // The choices are the query contract's, labelled here.
            options: [
              { value: "", label: "All responses" },
              ...eventOccurrenceInvitationResponseFilterSchema.options.map((value) => ({
                value,
                label: value === "none" ? "No answer" : RESPONSE_LABELS[value],
              })),
            ],
          },
        },
        {
          header: "Answered",
          cell: (invitation) => (invitation.respondedAt ? fmt(invitation.respondedAt) : "—"),
          className: "pk-small",
          width: "fit",
          hideable: true,
        },
      ]}
      empty="No join links have been sent for this meeting yet."
      rowKey={(invitation) => invitation.email}
    />
  );
}
