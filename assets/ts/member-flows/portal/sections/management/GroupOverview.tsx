/**
 * The group's front page: what is happening next (upcoming events, open
 * votes) before what the group is. Both lists are bounded server queries;
 * each row links into the tab that owns it.
 *
 * A feed that fails says so in place. Rendering an empty list for a failed
 * request tells the reader the group has nothing coming up, which is a
 * different — and wrong — statement.
 */
import { Link } from "wouter";
import { groupEventsListResponseSchema, type GroupEvent } from "../../../../../shared/schemas/group-events";
import { groupVotesListResponseSchema, type GroupVote } from "../../../../../shared/schemas/group-votes";
import { Alert } from "../../../../ui/Alert";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { formatEventWhen, formatRelativeDays } from "../../../../shared/ui";

function eventWhen(event: GroupEvent): string {
  const at = event.startsAt ?? event.nextOccurrenceAt;
  const relative = formatRelativeDays(at);
  const when = formatEventWhen(at, event.timezone, event.location);
  return relative ? `${when} (${relative})` : when;
}

function voteWhen(vote: GroupVote): string {
  const relative = formatRelativeDays(vote.closesAt);
  return relative ? `Closes ${relative}` : "Closing soon";
}

export function GroupOverviewView({
  groupId,
  description,
  upcomingEvents,
  openVotes,
  eventsError = null,
  votesError = null,
}: {
  groupId: string;
  description: string | null;
  upcomingEvents: readonly GroupEvent[];
  openVotes: readonly GroupVote[];
  eventsError?: string | null;
  votesError?: string | null;
}) {
  const showEvents = upcomingEvents.length > 0 || eventsError !== null;
  const showVotes = openVotes.length > 0 || votesError !== null;

  return (
    <div class="pk pk-stack">
      {(showEvents || showVotes) && (
        // One responsive grid instead of a breakpoint triplet: whichever
        // panels are present sit side by side when there is room for both and
        // stack when there is not, without either column naming a width.
        <div class="pk-grid pk-grid--roomy">
          {showEvents && (
            <Panel>
              <PanelHeader title="Upcoming events" />
              <PanelBody>
                {eventsError ? (
                  <Alert tone="danger">{eventsError}</Alert>
                ) : (
                  // The list is named, so a screen reader reaching it out of
                  // reading order is told which of the two feeds it is in.
                  <ul class="pk-stack pk-stack--snug" aria-label="Upcoming events">
                    {upcomingEvents.map((event) => (
                      <li key={event.id} class="pk-stack pk-stack--tight">
                        <Link
                          class="pk-strong"
                          href={`/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`}
                        >
                          {event.name}
                        </Link>
                        {/* The date sits beside the link rather than inside
                            it: a link announced as its own name is easier to
                            pick out of a list of links than one whose name
                            trails a formatted timestamp. */}
                        <span class="pk-small">{eventWhen(event)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          )}
          {showVotes && (
            <Panel>
              <PanelHeader title="Open votes" />
              <PanelBody>
                {votesError ? (
                  <Alert tone="danger">{votesError}</Alert>
                ) : (
                  <ul class="pk-stack pk-stack--snug" aria-label="Open votes">
                    {openVotes.map((vote) => (
                      <li key={vote.id} class="pk-stack pk-stack--tight">
                        <Link
                          class="pk-strong"
                          href={`/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(vote.id)}`}
                        >
                          {vote.title}
                        </Link>
                        <span class="pk-small">{voteWhen(vote)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          )}
        </div>
      )}
      <Panel>
        <PanelHeader title="About this group" />
        <PanelBody>
          <p>{description || "No group description has been provided."}</p>
        </PanelBody>
      </Panel>
    </div>
  );
}

export function GroupOverview({ groupId, description }: { groupId: string; description: string | null }) {
  const events = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/events?from=${encodeURIComponent(new Date().toISOString())}&sort=starts_at&limit=3`,
        groupEventsListResponseSchema,
      ),
    [groupId],
  );
  const votes = useData(
    () =>
      getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/votes?status=open&limit=3`, groupVotesListResponseSchema),
    [groupId],
  );
  return (
    <GroupOverviewView
      groupId={groupId}
      description={description}
      upcomingEvents={events.data?.events ?? []}
      openVotes={votes.data?.votes ?? []}
      eventsError={events.error}
      votesError={votes.error}
    />
  );
}
