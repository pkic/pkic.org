import { reorderMembershipCategories } from "../../../_lib/services/membership/category-ordering";
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
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import {
  membershipCategoryOrderRouteSchema,
  membershipCategoryCreateRouteSchema,
  membershipCategoryDeleteRouteSchema,
} from "../../../../assets/shared/schemas/membership-category-lifecycle";
import {
  createMembershipCategory,
  deleteMembershipCategory,
} from "../../../_lib/services/membership/category-lifecycle";

export const MembershipCategoryCreate = openApiRoute(
  membershipCategoryCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json({ category: await createMembershipCategory(db, staff, data.body) }, 201);
  },
);

export const MembershipCategoryDelete = openApiRoute(
  membershipCategoryDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json(await deleteMembershipCategory(db, staff, data.params.categoryCode, data.body.expectedRevision));
  },
);

export const MembershipCategoriesList = openApiRoute(membershipCategoryCatalogRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "membership:read");
  return json(
    membershipCategoryCatalogResponseSchema.parse({
      categories: await listMembershipCategories(db),
    }),
  );
});

export const MembershipCategoryUpdate = openApiRoute(
  membershipCategoryUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json(
      membershipCategoryResponseSchema.parse({
        category: await updateMembershipCategory(db, staff, data.params.categoryCode, data.body),
      }),
    );
  },
);

export const MembershipCategoryOrder = openApiRoute(
  membershipCategoryOrderRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json(membershipCategoryCatalogResponseSchema.parse(await reorderMembershipCategories(db, staff, data.body)));
  },
);
