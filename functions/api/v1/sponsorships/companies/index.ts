/**
 * GET /api/v1/sponsorships/companies — grouped, paginated company list for
 * the staff Sponsorships master/detail view. Grouping/sorting
 * happens in D1 (`listSponsorshipCompanies`), not by fetching every
 * matching sponsorship into the browser (PR #1 review).
 */
import { json } from "../../../../_lib/http";
import { listSponsorshipCompanies } from "../../../../_lib/services/sponsorship";
import {
  sponsorshipCompaniesListResponseSchema,
  sponsorshipCompaniesListRouteSchema,
} from "../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const SponsorshipCompaniesList = openApiRoute(
  sponsorshipCompaniesListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "sponsorships:read");

    const { companies, total } = await listSponsorshipCompanies(db, data.query);
    return json(
      sponsorshipCompaniesListResponseSchema.parse({
        companies,
        page: buildPageInfo(data.query.limit, data.query.offset, total, companies.length),
      }),
    );
  },
);
