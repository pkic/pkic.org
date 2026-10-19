import {
  organizationDomainClaimCreateRouteSchema,
  organizationDomainClaimDeleteRouteSchema,
  organizationDomainClaimPreviewResponseSchema,
  organizationDomainClaimPreviewRouteSchema,
  organizationDomainClaimResponseSchema,
  organizationDomainsListResponseSchema,
  organizationDomainsListRouteSchema,
} from "../../../../../assets/shared/schemas/organization-domains";
import { successResponseSchema } from "../../../../../assets/shared/schemas/api-common";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  claimOrganizationDomain,
  listOrganizationDomains,
  previewOrganizationDomainClaim,
  releaseOrganizationDomain,
} from "../../../../_lib/services/organization-management/domain-claims";
import { requireOrganizationStaffPermission } from "../authorization";

export const OrganizationDomainsGet = openApiRoute(
  organizationDomainsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireOrganizationStaffPermission(c, "organizations:read");
    return json(
      organizationDomainsListResponseSchema.parse(
        await listOrganizationDomains(db, data.params.organizationId, data.query),
      ),
    );
  },
);

export const OrganizationDomainClaimPost = openApiRoute(
  organizationDomainClaimCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireOrganizationStaffPermission(c, "organizations:write");
    const claimed = await claimOrganizationDomain(db, staff, data.params.organizationId, data.body);
    return json(organizationDomainClaimResponseSchema.parse(claimed), 201);
  },
);

export const OrganizationDomainClaimPreviewGet = openApiRoute(
  organizationDomainClaimPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireOrganizationStaffPermission(c, "organizations:write");
    const preview = await previewOrganizationDomainClaim(db, data.params.organizationId, data.params.domain);
    return json(organizationDomainClaimPreviewResponseSchema.parse({ preview }));
  },
);

export const OrganizationDomainClaimDelete = openApiRoute(
  organizationDomainClaimDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireOrganizationStaffPermission(c, "organizations:write");
    await releaseOrganizationDomain(db, staff, data.params.organizationId, data.params.domain);
    return json(successResponseSchema.parse({ success: true }));
  },
);
