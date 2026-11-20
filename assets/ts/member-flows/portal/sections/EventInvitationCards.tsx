/**
 * The signed-in person's open event invitations on Home: one card per event
 * they are invited to and have not registered for or declined, read from one
 * bounded backend query (`invitation=open`). Each card carries the event's own
 * invitation wording and leads to registration; the first invitation that is
 * not postponed also asks in a dialog, once per visit. Once registered, the
 * event leaves these cards and sits in the Events panel like any other event.
 */
import { useState } from "preact/hooks";
import type { z } from "zod";
import { EVENT_INVITATION_ACTIONS, eventInvitationWording } from "../../../../shared/event-invitation-copy";
import { eventRegisterRoute } from "../../../../shared/event-participation-link";
import { eventsListResponseSchema } from "../../../../shared/schemas/event-management";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { ButtonLink } from "../../../ui/Button";
import { Markdown } from "../../../ui/Markdown";
import { usePortalHashLocation } from "../hash-location";
import { EventCollectionCard } from "./events/EventCollectionCard";
import { EventInvitationDialog } from "./events/EventInvitationDialog";

type EventRow = z.infer<typeof eventsListResponseSchema>["events"][number];

const INVITATION_CARD_LIMIT = 6;

/** Whether the invitation should ask again: never postponed, or the postponement has run out. */
function asksAgain(invitation: { remindersPausedUntil: string | null }, now: number): boolean {
  return !invitation.remindersPausedUntil || Date.parse(invitation.remindersPausedUntil) <= now;
}

function InvitationBody({ event }: { event: EventRow }) {
  const wording = eventInvitationWording(event, event.invitationMessage);
  return (
    <div class="pk-stack pk-stack--snug">
      <p>
        <strong>{wording.headline}</strong>
      </p>
      {wording.message && <Markdown markdown={wording.message} />}
    </div>
  );
}

export function EventInvitationCards() {
  const invited = useData(
    () =>
      getJson(`/api/v1/events?invitation=open&sort=starts_at&limit=${INVITATION_CARD_LIMIT}`, eventsListResponseSchema),
    [],
  );
  // Closed for this visit, so the dialog asks once per page load, not on every render.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const events = invited.data?.events ?? [];
  const now = Date.now();
  const asking = events.find((event) => {
    const invitation = event.participation?.invitation;
    return invitation && !closed.has(invitation.id) && asksAgain(invitation, now);
  });
  const askingInvitation = asking?.participation?.invitation ?? null;

  if (invited.error) return <ErrorAlert error={invited.error} />;
  // A prompt, not a list: nothing shows while it loads or when nothing is open.
  if (events.length === 0) return null;
  return (
    <section class="pk-stack" aria-label="Your invitations">
      <ul class="pk-plain-list pk-stack pk-stack--snug">
        {events.map((event) => (
          <li key={event.id}>
            <EventCollectionCard
              headingLevel={3}
              event={event}
              body={<InvitationBody event={event} />}
              actions={
                <ButtonLink variant="primary" href={usePortalHashLocation.hrefs(eventRegisterRoute(event.slug))}>
                  {EVENT_INVITATION_ACTIONS.register}
                </ButtonLink>
              }
            />
          </li>
        ))}
      </ul>
      {asking && askingInvitation && (
        <EventInvitationDialog
          event={asking}
          inviteId={askingInvitation.id}
          onClose={() => setClosed(new Set([...closed, askingInvitation.id]))}
          onAnswered={() => {
            setClosed(new Set([...closed, askingInvitation.id]));
            void invited.reload();
          }}
        />
      )}
    </section>
  );
}
