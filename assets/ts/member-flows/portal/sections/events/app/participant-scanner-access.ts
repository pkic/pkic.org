/**
 * Which scanners the participant pages offer. Shared by the desktop event
 * tabs and the event app's "More", so both offer exactly the same entries.
 */
import type { z } from "zod";
import { availableScannerActions } from "../../../../../../shared/event-scanner-permissions";
import type { eventScannerAccessSchema } from "../../../../../../shared/schemas/event-management";
import { hasEventAgendaPermission, hasEventStaffPermission } from "../event-agenda-access";

type ScannerAccess = z.infer<typeof eventScannerAccessSchema>;
/**
 * Discovery and current contextual grants must both permit each independent entry. Badge scanning
 * is for this event's own staff (an event-scoped scanner grant); lead scanning is for people acting
 * for one of its sponsors (an exact sponsor-scoped grant). Attendee or speaker standing, and
 * unscoped administrator authority, add neither tab to the participant page; administrators reach
 * the scanner from the event workspace, and the scanner route keeps its own authorization.
 */
export function participantScannerAccess(eventId: string, access?: ScannerAccess) {
  return {
    canScan:
      Boolean(access?.canScan) &&
      availableScannerActions((permission) => hasEventStaffPermission(eventId, permission)).length > 0,
    sponsors:
      access?.sponsors.filter((sponsor) => hasEventAgendaPermission(eventId, "agenda:leads_capture", sponsor.id)) ?? [],
  };
}
