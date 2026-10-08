import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import type { EventAudienceViewer } from "./visibility";
import type { EventAudienceDetail } from "../../../../assets/shared/schemas/event-management";

type EventAudienceAccess = Pick<EventAudienceDetail, "scannerAccess" | "sponsorLeadAccess">;

/** Bounded operator discovery; no admission roster or sponsor contacts. */
export async function readEventAudienceAccess(db: DatabaseLike, viewer: EventAudienceViewer, eventIds: string[]) {
  const access = new Map<string, EventAudienceAccess>();
  if (!viewer.userId) return access;
  const grants = viewer.scannerGrants ?? [];
  for (const eventId of eventIds) {
    const canScan = grants.some(
      (grant) =>
        ["agenda:scan", "agenda:check", "agenda:admit", "agenda:attendance_record"].includes(grant.permission) &&
        ((grant.contextType === null && grant.contextId === null) ||
          (grant.contextType === "event" && grant.contextId === eventId)),
    );
    if (canScan) access.set(eventId, { scannerAccess: { canScan: true, sponsors: [] }, sponsorLeadAccess: false });
  }
  const sponsorIds = new Set<string>();
  const captureIds = new Set<string>();
  const contactIds = new Set<string>();
  for (const grant of grants) {
    if (grant.contextType !== "event_sponsor" || !grant.contextId) continue;
    if (grant.permission === "agenda:leads_capture") captureIds.add(grant.contextId);
    else if (["agenda:leads_view", "agenda:leads_export"].includes(grant.permission)) contactIds.add(grant.contextId);
    else continue;
    sponsorIds.add(grant.contextId);
  }
  if (!sponsorIds.size || !eventIds.length) return access;
  const sponsors = await all<{ id: string; event_id: string; name: string }>(
    db,
    `SELECT s.id,s.event_id,COALESCE(o.name,s.non_member_name,'Sponsor') AS name
     FROM sponsorships s LEFT JOIN organizations o ON o.id=s.organization_id
     WHERE s.id IN (SELECT value FROM json_each(?)) AND s.event_id IN (SELECT value FROM json_each(?))
     AND s.sponsor_type='event' AND s.pipeline_stage='active' ORDER BY s.event_id,name,s.id`,
    [JSON.stringify([...sponsorIds]), JSON.stringify(eventIds)],
  );
  for (const sponsor of sponsors) {
    const value: EventAudienceAccess = access.get(sponsor.event_id) ?? { sponsorLeadAccess: false };
    if (captureIds.has(sponsor.id)) {
      value.scannerAccess ??= { canScan: false, sponsors: [] };
      value.scannerAccess.sponsors.push({ id: sponsor.id, name: sponsor.name });
    }
    if (contactIds.has(sponsor.id)) value.sponsorLeadAccess = true;
    access.set(sponsor.event_id, value);
  }
  return access;
}
