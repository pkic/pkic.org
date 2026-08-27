import {
  membershipCategoryCatalogResponseSchema,
  membershipCategoryCatalogRouteSchema,
  membershipCategoryResponseSchema,
  membershipCategoryUpdateRouteSchema,
} from "../../../../assets/shared/schemas/membership-categories";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listMembershipCategories, updateMembershipCategory } from "../../../_lib/services/membership/categories";
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

export const SystemMembershipCategoryUpdate = openApiRoute(
  membershipCategoryUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireSystemPermission(c, "membership:write");
    return json(
      membershipCategoryResponseSchema.parse({
        category: await updateMembershipCategory(db, staff, data.params.categoryCode, data.body),
      }),
    );
  },
);
