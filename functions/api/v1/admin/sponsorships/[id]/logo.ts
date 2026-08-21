import {
  sponsorshipLogoDeleteRouteSchema,
  sponsorshipLogoPutRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { buildAdminLogoHandlers } from "../../../../../_lib/openapi/admin-logo-handlers";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { replaceSponsorshipLogo, removeSponsorshipLogo } from "../../../../../_lib/services/sponsorship/logo";

export const { onPut, onDelete, onRequest } = buildAdminLogoHandlers({
  replaceLogo: replaceSponsorshipLogo,
  removeLogo: removeSponsorshipLogo,
  publicLogoUrl: (id) => `/api/v1/sponsors/${id}/logo`,
});

export const SponsorshipLogoPut = openApiRoute(sponsorshipLogoPutRouteSchema, onPut);
export const SponsorshipLogoDelete = openApiRoute(sponsorshipLogoDeleteRouteSchema, onDelete);
