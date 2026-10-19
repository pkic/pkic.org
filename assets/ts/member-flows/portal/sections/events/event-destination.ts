import type { EventAudienceDetail, EventManagementSummary } from "../../../../../shared/schemas/event-management";
import { usePortalHashLocation } from "../../hash-location";
import { portalSectionEnabled } from "../../shell/portal-navigation";
import type { PortalSession } from "../../types";

/**
 * Every event row opens the group-independent event page. It already shows
 * the caller's own registration, agenda, proposals, and scanner tabs from the
 * caller-scoped projection, so no role decides a different home; the owning
 * group's workspace stays one explicit row action away for those who can
 * open it (see `canOpenGroupWorkspace`).
 */
export function eventDestination(event: EventAudienceDetail | EventManagementSummary): string {
  return usePortalHashLocation.hrefs(`/events/${encodeURIComponent(event.slug)}`);
}

/**
 * Whether this session can actually open the owning group's workspace.
 *
 * Any staff grant enables the groups section, but an event-scoped grant does
 * not reach the group surface; sending that identity there ends on a refusal.
 * A member, a global groups reader or writer, or a grant on this exact group
 * can open it.
 */
export function canOpenGroupWorkspace(session: PortalSession | null, groupId: string): boolean {
  if (!portalSectionEnabled(session, "groups")) return false;
  if (session?.member) return true;
  return Boolean(
    session?.staff?.grants.some(
      (grant) =>
        ((grant.permission === "groups:read" || grant.permission === "groups:write") &&
          grant.contextType === null &&
          grant.contextId === null) ||
        (grant.contextType === "group" && grant.contextId === groupId),
    ),
  );
}
