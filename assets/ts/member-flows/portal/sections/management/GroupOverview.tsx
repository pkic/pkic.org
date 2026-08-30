/**
 * The group's front page: what is happening next (upcoming events, open
 * votes) before what the group is. Both lists are bounded server queries;
 * each row links into the tab that owns it.
 */
import { Link } from "wouter";
import { groupEventsListResponseSchema, type GroupEvent } from "../../../../../shared/schemas/group-events";
import { groupVotesListResponseSchema, type GroupVote } from "../../../../../shared/schemas/group-votes";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { formatEventWhen, formatRelativeDays } from "../../../../shared/ui";

export function GroupOverviewView({
  groupId,
  description,
  upcomingEvents,
  openVotes,
}: {
  groupId: string;
  description: string | null;
  upcomingEvents: readonly GroupEvent[];
  openVotes: readonly GroupVote[];
}) {
  return (
    <div class="d-flex flex-column gap-3">
      {(upcomingEvents.length > 0 || openVotes.length > 0) && (
        <div class="row g-3">
          {upcomingEvents.length > 0 && (
            <div class={openVotes.length > 0 ? "col-md-6" : "col-12"}>
              <div class="card border-0 shadow-sm h-100">
                <div class="card-header bg-white fw-semibold">Upcoming events</div>
                <div class="list-group list-group-flush">
                  {upcomingEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={`/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`}
                      class="list-group-item list-group-item-action"
                    >
                      <span class="fw-semibold d-block">{event.name}</span>
                      <span class="text-muted small">
                        {formatEventWhen(event.startsAt ?? event.nextOccurrenceAt, event.timezone, event.location)}
                        {formatRelativeDays(event.startsAt ?? event.nextOccurrenceAt) &&
                          ` (${formatRelativeDays(event.startsAt ?? event.nextOccurrenceAt)})`}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
          {openVotes.length > 0 && (
            <div class={upcomingEvents.length > 0 ? "col-md-6" : "col-12"}>
              <div class="card border-0 shadow-sm h-100">
                <div class="card-header bg-white fw-semibold">Open votes</div>
                <div class="list-group list-group-flush">
                  {openVotes.map((vote) => (
                    <Link
                      key={vote.id}
                      href={`/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(vote.id)}`}
                      class="list-group-item list-group-item-action"
                    >
                      <span class="fw-semibold d-block">{vote.title}</span>
                      <span class="text-muted small">
                        {formatRelativeDays(vote.closesAt)
                          ? `Closes ${formatRelativeDays(vote.closesAt)}`
                          : "Closing soon"}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold">About this group</div>
        <div class="card-body">
          <p class="mb-0">{description || "No group description has been provided."}</p>
        </div>
      </div>
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
    />
  );
}
