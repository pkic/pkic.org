import { Route } from "wouter";
import type { PortalSession } from "../types";
import type { PortalAccess } from "./portal-access";
import { portalHasGlobalPermission } from "./portal-navigation";
import { PortalRouteRedirect, SectionWrapper } from "./PortalRouteChrome";
import { OrganizationDomainClaimForm, OrganizationDomains, OrganizationMergeForm } from "./portal-sections";

type OrganizationParams = { params: { organizationId: string } };

function organizationHref(organizationId: string, child = ""): string {
  return `/organizations/${encodeURIComponent(organizationId)}${child}`;
}

/**
 * The views under an organization record: its email domains, claiming a
 * domain, and the merge. Each has its own address and must be routed ahead
 * of `/organizations/:organizationId`, which would otherwise win.
 */
export function portalOrganizationRecordRoutes(access: PortalAccess, session: PortalSession | null) {
  const canRead = access.hasOrganizationsDirectory && portalHasGlobalPermission(session, "organizations:read");
  const canWrite = access.hasOrganizationsDirectory && portalHasGlobalPermission(session, "organizations:write");
  return [
    <Route key="domains-new" path="/organizations/:organizationId/domains/new">
      {(params: OrganizationParams["params"]) =>
        canWrite ? (
          <SectionWrapper>
            <OrganizationDomainClaimForm organizationId={params.organizationId} />
          </SectionWrapper>
        ) : (
          <PortalRouteRedirect to={organizationHref(params.organizationId, "/domains")} />
        )
      }
    </Route>,
    <Route key="domains" path="/organizations/:organizationId/domains">
      {(params: OrganizationParams["params"]) =>
        canRead ? (
          <SectionWrapper>
            <OrganizationDomains organizationId={params.organizationId} canWrite={canWrite} />
          </SectionWrapper>
        ) : (
          <PortalRouteRedirect to={organizationHref(params.organizationId)} />
        )
      }
    </Route>,
    <Route key="merge" path="/organizations/:organizationId/merge">
      {(params: OrganizationParams["params"]) =>
        access.hasOrganizationsDirectory && access.canMergeOrganizations ? (
          <SectionWrapper>
            <OrganizationMergeForm organizationId={params.organizationId} />
          </SectionWrapper>
        ) : (
          <PortalRouteRedirect to={organizationHref(params.organizationId)} />
        )
      }
    </Route>,
  ];
}
