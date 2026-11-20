/**
 * The signed-in person's open event invitations on Home: one card per event
 * they are invited to and have not registered for or declined, read from one
 * bounded backend query (`invitation=open`). Each card carries the event's own
 * invitation wording and leads to registration; the first invitation that is
 * not postponed also asks in a dialog; one invitation asks per visit. Once registered, the
 * event leaves these cards and sits in the Events panel like any other event.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { EVENT_INVITATION_ACTIONS, eventInvitationWording } from "../../../../shared/event-invitation-copy";
import { eventRegisterRoute } from "../../../../shared/event-participation-link";
import { eventsListResponseSchema } from "../../../../shared/schemas/event-management";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { useData } from "../../../hooks/useData";
import { useHashQueryParam } from "../../../hooks/useHashQueryParam";
import { getJson } from "../../../shared/api-client";
import { Button, ButtonLink } from "../../../ui/Button";
import { Markdown } from "../../../ui/Markdown";
import { usePortalHashLocation } from "../hash-location";
import { EventCollectionCard } from "./events/EventCollectionCard";
import { EventInvitationDialog } from "./events/EventInvitationDialog";

type EventRow = z.infer<typeof eventsListResponseSchema>["events"][number];

/** Cards per step; "Show more invitations" asks the backend for the next step. */
const INVITATION_CARD_STEP = 6;
/** The list endpoint's largest page. */
const INVITATION_CARD_MAX = 200;

/** How many cards the link asks for: a whole number of steps, or the endpoint's largest page. */
function invitationCardLimit(requested: string): number {
  const count = Number(requested);
  if (count >= INVITATION_CARD_MAX) return INVITATION_CARD_MAX;
  const steps = Math.trunc(count / INVITATION_CARD_STEP);
  return Number.isFinite(steps) && steps > 1
    ? Math.min(steps * INVITATION_CARD_STEP, INVITATION_CARD_MAX)
    : INVITATION_CARD_STEP;
}

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
  // The shown count is link state (`?invitations=12`), omitted at its default, so a refresh keeps it.
  const [requestedLimit, setRequestedLimit] = useHashQueryParam("invitations", String(INVITATION_CARD_STEP));
  const limit = invitationCardLimit(requestedLimit);
  // Read at fetch time, so showing more refreshes in place instead of clearing the cards while it loads.
  const fetchedLimit = useRef(limit);
  const invited = useData(
    () =>
      getJson(`/api/v1/events?invitation=open&sort=starts_at&limit=${fetchedLimit.current}`, eventsListResponseSchema),
    [],
  );
  const { reload } = invited;
  useEffect(() => {
    if (fetchedLimit.current === limit) return;
    fetchedLimit.current = limit;
    void reload();
  }, [limit, reload]);
  // One invitation asks per visit: once its dialog closes or is answered, no other one opens on its own.
  const [prompted, setPrompted] = useState(false);
  const events = invited.data?.events ?? [];
  const now = Date.now();
  const asking = prompted
    ? undefined
    : events.find((event) => {
        const invitation = event.participation?.invitation;
        return invitation && asksAgain(invitation, now);
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
      {invited.data?.page.hasMore && limit < INVITATION_CARD_MAX && (
        <div>
          <Button
            variant="secondary"
            disabled={invited.refreshing}
            onClick={() => setRequestedLimit(String(Math.min(limit + INVITATION_CARD_STEP, INVITATION_CARD_MAX)))}
          >
            Show more invitations
          </Button>
        </div>
      )}
      {asking && askingInvitation && (
        <EventInvitationDialog
          key={askingInvitation.id}
          event={asking}
          inviteId={askingInvitation.id}
          onClose={() => setPrompted(true)}
          onAnswered={() => {
            setPrompted(true);
            void invited.reload();
          }}
        />
      )}
    </section>
  );
}
