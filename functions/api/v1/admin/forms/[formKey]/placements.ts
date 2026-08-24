import {
  formPlacementCreateResponseSchema,
  formPlacementsListResponseSchema,
} from "../../../../../../assets/shared/schemas/forms";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import {
  adminFormPlacementCreateRouteSchema,
  adminFormPlacementUpdateRouteSchema,
  adminFormPlacementsListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  createManagedFormPlacement,
  getManagedFormWithFields,
  listFormPlacements,
  updateManagedFormPlacement,
} from "../../../../../_lib/services/forms";

async function requireFormId(db: ReturnType<typeof requestDb>, formKey: string): Promise<string> {
  const aggregate = await getManagedFormWithFields(db, formKey);
  if (!aggregate) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
  return aggregate.form.id;
}

export const AdminFormPlacementsList = openApiRoute(
  adminFormPlacementsListRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const formId = await requireFormId(requestDb(c), data.params.formKey);
    const result = await listFormPlacements(requestDb(c), formId, data.query);
    return json(
      formPlacementsListResponseSchema.parse({
        placements: result.placements,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.placements.length),
      }),
    );
  },
);

export const AdminFormPlacementCreate = openApiRoute(
  adminFormPlacementCreateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const formId = await requireFormId(requestDb(c), data.params.formKey);
    const placement = await createManagedFormPlacement(requestDb(c), admin.id, formId, data.body);
    return json(formPlacementCreateResponseSchema.parse({ success: true, placement }), 201);
  },
);

export const AdminFormPlacementUpdate = openApiRoute(
  adminFormPlacementUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const formId = await requireFormId(requestDb(c), data.params.formKey);
    const placement = await updateManagedFormPlacement(
      requestDb(c),
      admin.id,
      formId,
      data.params.placementId,
      data.body,
    );
    return json(formPlacementCreateResponseSchema.parse({ success: true, placement }));
  },
);
