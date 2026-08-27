import {
  membershipCategoryCatalogResponseSchema,
  membershipCategoryCatalogRouteSchema,
} from "../../../../assets/shared/schemas/membership-categories";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listMembershipCategories } from "../../../_lib/services/membership/categories";
import { requireSystemPermission } from "./authorization";

export const SystemMembershipCategoriesList = openApiRoute(
  membershipCategoryCatalogRouteSchema,
  async (c: AdminContext) => {
    const { db } = await requireSystemPermission(c, "membership:read");
    return json(
      membershipCategoryCatalogResponseSchema.parse({
        categories: await listMembershipCategories(db),
      }),
    );
  },
);
