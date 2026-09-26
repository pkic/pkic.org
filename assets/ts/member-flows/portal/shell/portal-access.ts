/**
 * What one session may reach, worked out once.
 *
 * The shell asked each of these questions inline, immediately above the route
 * table that consumes them — two dozen lines of derivation between the
 * component's opening and the first thing it renders. They are one
 * responsibility ("what is this reader allowed to open"), several of them are
 * needed by more than one route, and a couple encode a rule the API also
 * holds, which is exactly the kind of thing that should be named once.
 */
import { portalHasAnyGlobalPermission, portalHasGlobalPermission, portalSectionEnabled } from "./portal-navigation";
import type { PortalSession } from "../types";

export interface PortalAccess {
  hasGroupsAccess: boolean;
  hasEventWorkspace: boolean;
  hasSponsorWorkspace: boolean;
  hasFormsAccess: boolean;
  hasHomeAccess: boolean;
  hasMemberOrganization: boolean;
  hasMemberApplication: boolean;
  hasOrganizationsAccess: boolean;
  hasOrganizationsDirectory: boolean;
  canCreateOrganizations: boolean;
  hasMembershipQueue: boolean;
  hasMembersRoll: boolean;
  canGrantMembership: boolean;
  /** Everybody signed in can reach a user record: their own. */
  hasUserRecords: boolean;
  hasDonationsAccess: boolean;
  hasSettingsAccess: boolean;
  hasAccountAccess: boolean;
  hasAdminCapacity: boolean;
  canReadAnalytics: boolean;
  hasParticipationRecord: boolean;
}

export function derivePortalAccess(session: PortalSession | null): PortalAccess {
  /*
   * Creating an organization activates its initial identities at once, and a
   * membership grant does the same, so both take the pair of permissions the
   * API demands rather than just the write. Named here because the directory
   * route and the create route have to agree on who may reach the create page.
   */
  const activatesOnWrite =
    portalHasGlobalPermission(session, "membership:write") && portalHasGlobalPermission(session, "identities:activate");

  return {
    hasGroupsAccess: portalSectionEnabled(session, "groups"),
    hasEventWorkspace: portalSectionEnabled(session, "events"),
    hasSponsorWorkspace: portalSectionEnabled(session, "sponsors"),
    hasFormsAccess: portalSectionEnabled(session, "forms"),
    hasHomeAccess: portalSectionEnabled(session, "home"),
    hasMemberOrganization: portalSectionEnabled(session, "organization"),
    hasMemberApplication: portalSectionEnabled(session, "application"),
    hasOrganizationsAccess: portalSectionEnabled(session, "organizations"),
    hasOrganizationsDirectory: portalHasAnyGlobalPermission(session, ["organizations:read", "membership:write"]),
    canCreateOrganizations: activatesOnWrite,
    hasMembershipQueue: portalSectionEnabled(session, "membership"),
    hasMembersRoll: portalSectionEnabled(session, "members"),
    canGrantMembership: activatesOnWrite,
    hasUserRecords: portalSectionEnabled(session, "users"),
    hasDonationsAccess: portalSectionEnabled(session, "donations"),
    hasSettingsAccess: portalSectionEnabled(session, "settings"),
    hasAccountAccess: portalSectionEnabled(session, "account"),
    hasAdminCapacity: Boolean(session?.staff),
    canReadAnalytics: portalHasGlobalPermission(session, "analytics:read"),
    hasParticipationRecord: portalSectionEnabled(session, "participation"),
  };
}
