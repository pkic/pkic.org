/**
 * GET /api/v1/admin/sponsorships/companies — grouped, paginated company
 * list for the admin Sponsorships master/detail view. Grouping/sorting
 * happens in D1 (`listSponsorshipCompanies`), not by fetching every
 * matching sponsorship into the browser (PR #1 review).
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { listSponsorshipCompanies } from "../../../../../_lib/services/sponsorship";
import {
  sponsorshipCompaniesListResponseSchema,
  sponsorshipCompaniesListRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

export const SponsorshipCompaniesList = openApiRoute(
  sponsorshipCompaniesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "sponsorships:read");

    const { companies, total } = await listSponsorshipCompanies(db, data.query);
    return json(
      sponsorshipCompaniesListResponseSchema.parse({
        companies,
        page: buildPageInfo(data.query.limit, data.query.offset, total, companies.length),
      }),
    );
  },
);
