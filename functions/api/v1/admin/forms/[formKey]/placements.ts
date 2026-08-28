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
import { isAuthorizationGuardFailure } from "../../../../../_lib/db/authorization-guard";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  createManagedFormPlacement,
  getManagedFormWithFields,
  listFormPlacements,
  prepareLegacyAdminFormPlacementTargetGuard,
  requireLegacyAdminFormMutationBoundary,
  updateManagedFormPlacement,
} from "../../../../../_lib/services/forms";

async function requireManagedForm(db: ReturnType<typeof requestDb>, formKey: string) {
  const aggregate = await getManagedFormWithFields(db, formKey);
  if (!aggregate) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
  return aggregate.form;
}

export const AdminFormPlacementsList = openApiRoute(
  adminFormPlacementsListRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const form = await requireManagedForm(requestDb(c), data.params.formKey);
    const result = await listFormPlacements(requestDb(c), form.id, data.query);
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
    const form = await requireManagedForm(requestDb(c), data.params.formKey);
    await requireLegacyAdminFormMutationBoundary(requestDb(c), form);
    let placement;
    try {
      placement = await createManagedFormPlacement(requestDb(c), admin.id, form.id, data.body, [
        prepareLegacyAdminFormPlacementTargetGuard(requestDb(c), form, data.body),
      ]);
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(
          403,
          "PORTAL_EVENT_FORM_MANAGEMENT_REQUIRED",
          "Portal event-flow forms must be changed from their owning group context.",
        );
      }
      throw error;
    }
    return json(formPlacementCreateResponseSchema.parse({ success: true, placement }), 201);
  },
);

export const AdminFormPlacementUpdate = openApiRoute(
  adminFormPlacementUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const form = await requireManagedForm(requestDb(c), data.params.formKey);
    await requireLegacyAdminFormMutationBoundary(requestDb(c), form);
    let placement;
    try {
      placement = await updateManagedFormPlacement(
        requestDb(c),
        admin.id,
        form.id,
        data.params.placementId,
        data.body,
        null,
        [],
        (next) => [prepareLegacyAdminFormPlacementTargetGuard(requestDb(c), form, next)],
      );
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(
          403,
          "PORTAL_EVENT_FORM_MANAGEMENT_REQUIRED",
          "Portal event-flow forms must be changed from their owning group context.",
        );
      }
      throw error;
    }
    return json(formPlacementCreateResponseSchema.parse({ success: true, placement }));
  },
);
