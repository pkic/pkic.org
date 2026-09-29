/**
 * The analytics pages, one per domain (#39).
 *
 * They used to be a single system-wide panel inside Settings, which put the
 * membership figures three clicks from the membership roll and under a
 * heading that named none of them. Each domain answers for its own numbers
 * now, at an address under the domain it measures.
 *
 * They are grouped here rather than written inline in `PortalShell` because
 * they share one constraint that the rest of the shell does not: every one of
 * them is a RESERVED SEGMENT and has to be matched before its section's own
 * `:id` route, or wouter — which renders the first match — reads "analytics"
 * as the id of a record and opens a detail page for a membership, an
 * organization or a user that does not exist. Keeping them together is what
 * makes that rule visible instead of being three comments in three places.
 *
 * Returned as an array so `<Switch>` still sees `<Route>` elements as its own
 * children: a component wrapping them would be one child that Switch cannot
 * match against, and every route inside it would stop resolving.
 */
import { Route } from "wouter";
import type { ComponentChildren } from "preact";
import { MembershipAnalytics, OrganizationAnalytics, UserAnalytics } from "./portal-sections";
import type { PortalAccess } from "./portal-access";

export function portalAnalyticsRoutes(
  access: PortalAccess,
  wrap: (children: ComponentChildren) => ComponentChildren,
): ComponentChildren[] {
  if (!access.canReadAnalytics) return [];

  return [
    access.hasMembersRoll && (
      <Route key="members-analytics" path="/members/analytics" component={() => wrap(<MembershipAnalytics />)} />
    ),
    access.hasOrganizationsAccess && (
      <Route
        key="organizations-analytics"
        path="/organizations/analytics"
        component={() => wrap(<OrganizationAnalytics />)}
      />
    ),
    access.hasUserRecords && (
      <Route key="users-analytics" path="/users/analytics" component={() => wrap(<UserAnalytics />)} />
    ),
  ];
}
