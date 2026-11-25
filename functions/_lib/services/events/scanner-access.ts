import type { AuthAdmin, DatabaseLike } from "../../types";
import { isUserBackedAuthAdmin } from "../../auth/admin-identity";
import { anyPermissionAuthorizationEvidenceForResource, tokenAllowsPermission } from "../../auth/permissions";
import {
  activeLeadSponsorOfEventSql,
  sponsorLeadViewerExistsSql,
  sponsorOrganizationCaptureExistsSql,
} from "../../auth/sponsor-organization-lead-access";
import { eventReadSelectionSql, type EventReadSelection } from "./read-selection";
import type { EventAudienceViewer } from "./visibility";
import type { EventAudienceDetail } from "../../../../assets/shared/schemas/event-management";

export type EventAudienceAccess = Pick<EventAudienceDetail, "scannerAccess" | "sponsorLeadAccess"> & {
  /** The viewer holds a grant on this event, which only the event's team roles give. */
  team?: boolean;
};

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
    const team = grants.some((grant) => grant.contextType === "event" && grant.contextId === eventId);
    if (canScan || team)
      access.set(eventId, {
        ...(canScan ? { scannerAccess: { canScan: true, sponsors: [] } } : {}),
        sponsorLeadAccess: false,
        ...(team ? { team } : {}),
      });
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

const SPONSOR_LEAD_PERMISSIONS = ["agenda:leads_capture", "agenda:leads_view", "agenda:leads_export"] as const;

/** Resolve only active sponsor names authorized for this subject and event selection, in the resource batch. */
export function prepareEventAudienceSponsors(
  db: DatabaseLike,
  viewer: EventAudienceViewer,
  selection: EventReadSelection,
) {
  const actor = viewer.admin ?? { identityType: "user" as const, id: viewer.userId ?? "", email: "" };
  const authority = anyPermissionAuthorizationEvidenceForResource(actor, SPONSOR_LEAD_PERMISSIONS, {
    type: "event_sponsor",
    idSql: "s.id",
  });
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
  const filter = eventReadSelectionSql("audience_event.id", selection);
  const candidates = viewerLeadSponsorCandidates(actor);
  // The full sponsorship policy runs only on the viewer's few candidate sponsorships, never on every one.
  const withSql = `WITH ${filter.withSql ? `${filter.withSql}, ` : ""}viewer_lead_sponsors AS MATERIALIZED (${candidates.sql}),
    authorized_event_sponsors AS MATERIALIZED (SELECT s.id FROM viewer_lead_sponsors candidate
      CROSS JOIN sponsorships s ON s.id=candidate.id
      WHERE s.pipeline_stage='active' AND (EXISTS(${authority.sql})${liveCapacitySql})) `;
  // Consortium sponsorships have no event of their own, so each event supplies the row's event. The join
  // carries the full sponsorship policy; the authority CTE only narrows by stage to stay within D1's depth limit.
  // CROSS JOIN keeps the few authorized sponsorships as the outer loop, so no other sponsorship is read.
  const eventSource = filter.idsSql ? `(${filter.idsSql}) audience_event` : "events audience_event";
  const eventFilter = filter.idsSql ? "" : `${filter.sql} AND `;
  return db
    .prepare(`${withSql}SELECT s.id,audience_event.id AS event_id,COALESCE(o.name,s.non_member_name,'Sponsor') AS name
    FROM authorized_event_sponsors authorized CROSS JOIN sponsorships s ON s.id=authorized.id
    CROSS JOIN ${eventSource} ON ${activeLeadSponsorOfEventSql("s", "audience_event.id")}
    LEFT JOIN organizations o ON o.id=s.organization_id
    WHERE ${eventFilter}1
    ORDER BY audience_event.id,name,s.id`)
    .bind(
      ...(filter.withSql ? filter.bindings : []),
      ...candidates.bindings,
      ...authority.bindings,
      ...(organizationCapture ? [viewer.userId] : []),
      ...(designatedContact ? [viewer.userId] : []),
      ...(filter.withSql ? [] : filter.bindings),
    );
}

/**
 * Every sponsorship that could pass the lead policy for this viewer: one their own sponsor grant names, one of
 * an organization they act for (staff and primary contacts), or one whose contact mailbox is theirs. A viewer
 * with a lead grant over every sponsorship, and a non-user caller, keeps every active sponsorship. This is
 * only a superset that keeps the policy off unrelated rows; the policy itself still decides each candidate.
 */
function viewerLeadSponsorCandidates(actor: AuthAdmin): { sql: string; bindings: unknown[] } {
  if (!isUserBackedAuthAdmin(actor))
    return { sql: "SELECT id FROM sponsorships WHERE pipeline_stage='active'", bindings: [] };
  const permissions = JSON.stringify(SPONSOR_LEAD_PERMISSIONS);
  // Unary `+` drops the column's TEXT affinity, which would otherwise keep the mailbox index from seeking.
  const mailbox = "lower(trim(s.contact_email))";
  return {
    sql: `SELECT role.context_id AS id FROM user_roles role
        WHERE role.user_id=? AND role.context_type='event_sponsor'
      UNION SELECT grant_row.context_id FROM permission_grants grant_row
        WHERE grant_row.user_id=? AND grant_row.context_type='event_sponsor'
      UNION SELECT s.id FROM identities identity CROSS JOIN sponsorships s ON s.organization_id=identity.organization_id
        WHERE identity.user_id=? AND identity.organization_id IS NOT NULL
      UNION SELECT s.id FROM (
          SELECT normalized_email FROM users WHERE id=? AND normalized_email IS NOT NULL
          UNION SELECT normalized_email FROM user_emails WHERE user_id=?
        ) mailbox CROSS JOIN sponsorships s
        ON s.contact_email IS NOT NULL AND ${mailbox}=+mailbox.normalized_email
      UNION SELECT s.id FROM (SELECT 1 WHERE
          EXISTS(SELECT 1 FROM user_roles role JOIN role_permissions role_permission ON role_permission.role_id=role.role_id
            WHERE role.user_id=? AND role.context_type IS NULL AND role.context_id IS NULL
              AND role_permission.permission IN (SELECT value FROM json_each(?)))
          OR EXISTS(SELECT 1 FROM permission_grants grant_row
            WHERE grant_row.user_id=? AND grant_row.context_type IS NULL AND grant_row.context_id IS NULL
              AND grant_row.permission IN (SELECT value FROM json_each(?)))
        ) lead_grant_over_all CROSS JOIN sponsorships s WHERE s.pipeline_stage='active'`,
    bindings: [actor.id, actor.id, actor.id, actor.id, actor.id, actor.id, permissions, actor.id, permissions],
  };
}

export async function readEventAudienceAccess(db: DatabaseLike, viewer: EventAudienceViewer, eventIds: string[]) {
  const needsSponsors = eventIds.length > 0 && Boolean(viewer.userId || viewer.admin);
  const sponsors = needsSponsors
    ? (await prepareEventAudienceSponsors(db, viewer, eventIds).all<EventAudienceSponsorRow>()).results
    : [];
  return decodeEventAudienceAccess(viewer, eventIds, sponsors);
}
