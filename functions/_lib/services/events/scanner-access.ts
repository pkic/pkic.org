import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import type { EventAudienceViewer } from "./visibility";
import type { EventAudienceDetail } from "../../../../assets/shared/schemas/event-management";

/** Bounded discovery links for an operator; no admission roster or sponsor contacts. */
export async function readEventScannerAccess(db: DatabaseLike, viewer: EventAudienceViewer, eventIds: string[]) {
  const access = new Map<string, NonNullable<EventAudienceDetail["scannerAccess"]>>();
  if (!viewer.userId) return access;
  const grants = viewer.scannerGrants ?? [];
  for (const eventId of eventIds) {
    const canScan = grants.some(
      (grant) =>
        grant.permission === "agenda:scan" &&
        ((grant.contextType === null && grant.contextId === null) ||
          (grant.contextType === "event" && grant.contextId === eventId)),
    );
    if (canScan) access.set(eventId, { canScan: true, sponsors: [] });
  }
  const sponsorIds = grants.flatMap((grant) =>
    grant.permission === "agenda:leads_capture" && grant.contextType === "event_sponsor" && grant.contextId
      ? [grant.contextId]
      : [],
  );
  if (!sponsorIds.length || !eventIds.length) return access;
  const sponsors = await all<{ id: string; event_id: string; name: string }>(
    db,
    `SELECT s.id,s.event_id,COALESCE(o.name,s.non_member_name,'Sponsor') AS name
     FROM sponsorships s LEFT JOIN organizations o ON o.id=s.organization_id
     WHERE s.id IN (SELECT value FROM json_each(?)) AND s.event_id IN (SELECT value FROM json_each(?))
     AND s.sponsor_type='event' AND s.pipeline_stage='active' ORDER BY s.event_id,name,s.id`,
    [JSON.stringify(sponsorIds), JSON.stringify(eventIds)],
  );
  for (const sponsor of sponsors) {
    const value = access.get(sponsor.event_id) ?? { canScan: false, sponsors: [] };
    value.sponsors.push({ id: sponsor.id, name: sponsor.name });
    access.set(sponsor.event_id, value);
  }
  return access;
}
