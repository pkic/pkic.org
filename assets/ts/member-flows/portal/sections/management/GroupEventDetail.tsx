import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { getLinkLabel } from "../../../../../shared/schemas/links";
import { Badge } from "../../../../components/Badge";
import { fmt } from "../../ui";
import { GroupEventRegistrations } from "./GroupEventRegistrations";
import { GroupEventRegistrationPanel } from "./GroupEventRegistrationPanel";
import { GroupEventConfiguration } from "./GroupEventConfiguration";
import { GroupEventInvitations } from "./GroupEventInvitations";
import { GroupEventProposals } from "./GroupEventProposals";
import { GroupEventCommunications } from "./GroupEventCommunications";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function canReadProposalProgram(event: GroupEvent): boolean {
  return event.proposalAccess?.canRead === true;
}

export function GroupEventDetail({
  event,
  groupId,
  onEdit,
  onUpdated,
}: {
  event: GroupEvent;
  groupId: string;
  onEdit?: () => void;
  onUpdated?: () => void | Promise<void>;
}) {
  const canManage = event.capabilities.includes("manage");
  const canRegister = event.registrationPolicy !== "no_registration" && event.capabilities.includes("register");

  return (
    <section aria-label={`${event.name} details`} class="d-flex flex-column gap-3">
      <div>
        <h6 class="mb-1">{event.name}</h6>
        <p class="small text-muted mb-0">{event.slug}</p>
      </div>

      <dl class="row mb-0 small">
        <dt class="col-sm-3">When</dt>
        <dd class="col-sm-9">{fmt(event.nextOccurrenceAt ?? event.startsAt)}</dd>
        {event.endsAt && (
          <>
            <dt class="col-sm-3">Ends</dt>
            <dd class="col-sm-9">{fmt(event.endsAt)}</dd>
          </>
        )}
        <dt class="col-sm-3">Profile</dt>
        <dd class="col-sm-9">
          <Badge status={event.profileKey ?? "event"} />
        </dd>
        <dt class="col-sm-3">Registration</dt>
        <dd class="col-sm-9">{label(event.registrationPolicy)}</dd>
        {event.location && (
          <>
            <dt class="col-sm-3">Location</dt>
            <dd class="col-sm-9">{event.location}</dd>
          </>
        )}
      </dl>

      {event.links.length > 0 && (
        <div>
          <h6 class="small fw-semibold">Event links</h6>
          <ul class="list-unstyled mb-0 d-flex flex-column gap-1">
            {event.links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {getLinkLabel(url)}
                  <span class="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canRegister && <GroupEventRegistrationPanel event={event} groupId={groupId} />}

      {canManage && !event.seriesId && (
        <GroupEventConfiguration event={event} groupId={groupId} onUpdated={onUpdated} />
      )}

      {canManage && (
        <div class="border-top pt-3">
          {onEdit && (
            <button type="button" class="btn btn-sm btn-primary me-2" onClick={onEdit}>
              Edit event
            </button>
          )}
          {event.seriesId ? (
            <a class="btn btn-sm btn-outline-secondary" href={`#/groups/${encodeURIComponent(groupId)}/meetings`}>
              Manage meeting series
            </a>
          ) : null}
        </div>
      )}

      {canManage && <GroupEventInvitations groupId={groupId} event={event} />}

      {canManage && <GroupEventCommunications groupId={groupId} eventId={event.id} />}

      {event.proposalAccess?.canFinalize && (
        <GroupEventInvitations groupId={groupId} event={event} inviteType="speaker" />
      )}

      {canReadProposalProgram(event) && (
        <GroupEventProposals groupId={groupId} eventId={event.id} eventSlug={event.slug} />
      )}

      {event.capabilities.includes("manage_attendance") && (
        <div class="border-top pt-3">
          <GroupEventRegistrations groupId={groupId} eventId={event.id} />
        </div>
      )}
    </section>
  );
}
