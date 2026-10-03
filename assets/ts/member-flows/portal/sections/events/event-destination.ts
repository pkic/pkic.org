import type { EventAudienceDetail, EventManagementSummary } from "../../../../../shared/schemas/event-management";
import { usePortalHashLocation } from "../../hash-location";

/** Use the caller-scoped API projection, never the roles of the person being viewed. */
export function eventDestination(event: EventAudienceDetail | EventManagementSummary): string | null {
  if ("scannerAccess" in event && event.scannerAccess?.canScan)
    return usePortalHashLocation.hrefs(`/events/${encodeURIComponent(event.slug)}/scanner`);
  if ("scannerAccess" in event && event.scannerAccess?.sponsors.length)
    return usePortalHashLocation.hrefs(
      `/events/${encodeURIComponent(event.slug)}/sponsors/${encodeURIComponent(event.scannerAccess.sponsors[0].id)}/scanner`,
    );
  if (event.participation?.registrationId || event.participation?.proposals || event.participation?.speakerProposals)
    return usePortalHashLocation.hrefs(`/events/${encodeURIComponent(event.slug)}`);
  if (!("viewer" in event)) {
    return usePortalHashLocation.hrefs(
      event.ownerGroupId
        ? `/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}`
        : `/events/${encodeURIComponent(event.slug)}`,
    );
  }
  if (event.viewer) return usePortalHashLocation.hrefs(`/events/${encodeURIComponent(event.slug)}`);
  return usePortalHashLocation.hrefs(`/events/${encodeURIComponent(event.slug)}`);
}
