import {
  organizationManagementLogoDeleteRouteSchema,
  organizationManagementLogoPutRouteSchema,
} from "../../../../../assets/shared/schemas/organization-management";
import { buildOrganizationLogoHandlers } from "../../../../_lib/openapi/organization-logo-handlers";
import { removeOrganizationLogo, replaceOrganizationLogo } from "../../../../_lib/services/organization-logo";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const { onPut, onDelete, onRequest } = buildOrganizationLogoHandlers({
  replaceLogo: replaceOrganizationLogo,
  removeLogo: removeOrganizationLogo,
  publicLogoUrl: (id) => `/api/v1/members/${id}/logo`,
  idParam: "organizationId",
});

export const OrganizationLogoPut = openApiRoute(organizationManagementLogoPutRouteSchema, onPut);
export const OrganizationLogoDelete = openApiRoute(organizationManagementLogoDeleteRouteSchema, onDelete);
