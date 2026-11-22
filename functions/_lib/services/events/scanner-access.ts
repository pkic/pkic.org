import type { DatabaseLike } from "../../types";
import { anyPermissionAuthorizationEvidenceForResource, tokenAllowsPermission } from "../../auth/permissions";
import {
  activeEventSponsorSql,
  sponsorLeadViewerExistsSql,
  sponsorOrganizationCaptureExistsSql,
} from "../../auth/sponsor-organization-lead-access";
import { eventReadSelectionSql, type EventReadSelection } from "./read-selection";
import type { EventAudienceViewer } from "./visibility";
import type { EventAudienceDetail } from "../../../../assets/shared/schemas/event-management";

export type EventAudienceAccess = Pick<EventAudienceDetail, "scannerAccess" | "sponsorLeadAccess">;

/** Bounded operator discovery; no admission roster or sponsor contacts. */
export interface EventAudienceSponsorRow {
  id: string;
  event_id: string;
  name: string;
}

export function decodeEventAudienceAccess(
  viewer: EventAudienceViewer,
  eventIds: string[],
  sponsors: EventAudienceSponsorRow[],
) {
  const access = new Map<string, EventAudienceAccess>();
  if (!viewer.userId && !viewer.admin) return access;
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
  const captureIds = new Set<string>();
  for (const grant of grants) {
    if (grant.contextType !== "event_sponsor" || !grant.contextId) continue;
    if (grant.permission === "agenda:leads_capture") captureIds.add(grant.contextId);
  }
  for (const sponsor of sponsors) {
    const value: EventAudienceAccess = access.get(sponsor.event_id) ?? { sponsorLeadAccess: false };
    if (captureIds.has(sponsor.id)) {
      value.scannerAccess ??= { canScan: false, sponsors: [] };
      value.scannerAccess.sponsors.push({ id: sponsor.id, name: sponsor.name });
    }
    value.sponsorLeadAccess = true;
    access.set(sponsor.event_id, value);
  }
  return access;
}

/** Resolve only active sponsor names authorized for this subject and event selection, in the resource batch. */
export function prepareEventAudienceSponsors(
  db: DatabaseLike,
  viewer: EventAudienceViewer,
  selection: EventReadSelection,
) {
  const actor = viewer.admin ?? { identityType: "user" as const, id: viewer.userId ?? "", email: "" };
  const authority = anyPermissionAuthorizationEvidenceForResource(
    actor,
    ["agenda:leads_capture", "agenda:leads_view", "agenda:leads_export"],
    { type: "event_sponsor", idSql: "s.id" },
  );
  const organizationCapture =
    viewer.userId && !viewer.admin?.scopeRestricted && tokenAllowsPermission(actor, "agenda:leads_capture")
      ? sponsorOrganizationCaptureExistsSql("?", "s.id")
      : null;
  const designatedContact =
    viewer.userId &&
    !viewer.admin?.scopeRestricted &&
    (tokenAllowsPermission(actor, "agenda:leads_view") || tokenAllowsPermission(actor, "agenda:leads_export"))
      ? sponsorLeadViewerExistsSql("?", "s.id")
      : null;
  const liveCapacitySql = `${organizationCapture ? ` OR ${organizationCapture}` : ""}${designatedContact ? ` OR ${designatedContact}` : ""}`;
  const filter = eventReadSelectionSql("s.event_id", selection);
  const withSql = filter.withSql
    ? `WITH ${filter.withSql}, authorized_event_sponsors AS MATERIALIZED (SELECT s.id FROM sponsorships s WHERE ${activeEventSponsorSql("s")} AND (EXISTS(${authority.sql})${liveCapacitySql})) `
    : "";
  const authoritySql = filter.withSql
    ? "s.id IN (SELECT id FROM authorized_event_sponsors)"
    : `(EXISTS(${authority.sql})${liveCapacitySql})`;
  const activeFilter = filter.withSql ? "" : ` AND ${activeEventSponsorSql("s")}`;
  return db
    .prepare(`${withSql}SELECT s.id,s.event_id,COALESCE(o.name,s.non_member_name,'Sponsor') AS name
    FROM sponsorships s LEFT JOIN organizations o ON o.id=s.organization_id
    WHERE ${filter.sql}${activeFilter} AND ${authoritySql}
    ORDER BY s.event_id,name,s.id`)
    .bind(
      ...filter.bindings,
      ...authority.bindings,
      ...(organizationCapture ? [viewer.userId] : []),
      ...(designatedContact ? [viewer.userId] : []),
    );
}

export async function readEventAudienceAccess(db: DatabaseLike, viewer: EventAudienceViewer, eventIds: string[]) {
  const needsSponsors = eventIds.length > 0 && Boolean(viewer.userId || viewer.admin);
  const sponsors = needsSponsors
    ? (await prepareEventAudienceSponsors(db, viewer, eventIds).all<EventAudienceSponsorRow>()).results
    : [];
  return decodeEventAudienceAccess(viewer, eventIds, sponsors);
}
