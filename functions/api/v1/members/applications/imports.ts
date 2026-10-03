import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { membershipApplicationImportRouteSchema } from "../../../../../assets/shared/schemas/membership-application-import-routes";
import { membershipApplicationImportResponseSchema } from "../../../../../assets/shared/schemas/membership-application-import";
import { importMembershipApplication } from "../../../../_lib/services/membership/applications/import";
import { githubApplicationSourceReader } from "../../../../_lib/services/membership/applications/github-source";

export const MembershipApplicationImport = openApiRoute(
  membershipApplicationImportRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:approve");
    const result = await importMembershipApplication(db, staff, {
      ...data.body,
      readSource: githubApplicationSourceReader(c.env.GITHUB_MEMBERS_IMPORT_TOKEN),
    });
    return json(membershipApplicationImportResponseSchema.parse(result));
  },
);
