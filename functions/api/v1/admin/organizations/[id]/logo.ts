import {
  adminOrganizationLogoDeleteRouteSchema,
  adminOrganizationLogoPutRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";
import { buildAdminLogoHandlers } from "../../../../../_lib/openapi/admin-logo-handlers";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { removeOrganizationLogo, replaceOrganizationLogo } from "../../../../../_lib/services/organization-logo";

export const { onPut, onDelete, onRequest } = buildAdminLogoHandlers({
  replaceLogo: replaceOrganizationLogo,
  removeLogo: removeOrganizationLogo,
  publicLogoUrl: (id) => `/api/v1/members/${id}/logo`,
});

export const OrganizationLogoPut = openApiRoute(adminOrganizationLogoPutRouteSchema, onPut);
export const OrganizationLogoDelete = openApiRoute(adminOrganizationLogoDeleteRouteSchema, onDelete);
