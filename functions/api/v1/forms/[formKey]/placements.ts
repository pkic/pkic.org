import {
  formPlacementCreateResponseSchema,
  formPlacementsListResponseSchema,
} from "../../../../../assets/shared/schemas/forms";
import {
  formPlacementCreateRouteSchema,
  formPlacementUpdateRouteSchema,
  formPlacementsListRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-forms";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { guardPermissionMutationDatabase, requirePermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  createManagedFormPlacement,
  findFormPlacement,
  getManagedFormWithFields,
  listFormPlacements,
  prepareManagedFormPlacementTargetGuard,
  requireGlobalFormPlacementTargetBoundary,
  requireManagedFormMutationBoundary,
  requireManagedFormPlacementTargetBoundary,
  updateManagedFormPlacement,
} from "../../../../_lib/services/forms";
import { AppError } from "../../../../_lib/errors";
import { rejectLegacyMembershipApplicationFormRoute } from "../../../../_lib/services/membership/application-form";

async function requireGlobalForm(db: ReturnType<typeof requestDb>, key: string) {
  rejectLegacyMembershipApplicationFormRoute(key);
  const aggregate = await getManagedFormWithFields(db, key);
  if (!aggregate || aggregate.form.scope_type !== "global")
    throw new AppError(404, "FORM_NOT_FOUND", `Form '${key}' not found`);
  return aggregate;
}

function guardedFormsDatabase(c: AdminContext, actor: Awaited<ReturnType<typeof requireUserBackedAdminFromRequest>>) {
  return guardPermissionMutationDatabase(
    requestDb(c),
    actor,
    [{ permission: "forms:write" }],
    () =>
      new AppError(
        409,
        "FORM_AUTHORIZATION_CHANGED",
        "Form-management permission changed while the placement was being saved",
      ),
  );
}

export const FormPlacementsList = openApiRoute(formPlacementsListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:read");
  const aggregate = await requireGlobalForm(requestDb(c), data.params!.formKey);
  const result = await listFormPlacements(requestDb(c), aggregate.form.id, data.query!, { unownedOnly: true });
  return json(
    formPlacementsListResponseSchema.parse({
      placements: result.placements,
      page: buildPageInfo(data.query!.limit, data.query!.offset, result.total, result.placements.length),
    }),
  );
});

export const FormPlacementCreate = openApiRoute(formPlacementCreateRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:write");
  const aggregate = await requireGlobalForm(requestDb(c), data.params!.formKey);
  await requireManagedFormMutationBoundary(requestDb(c), aggregate.form);
  if (data.body!.ownerGroupId !== null)
    throw new AppError(
      403,
      "GROUP_FORM_MANAGEMENT_REQUIRED",
      "Group placements must be managed from the owning group context.",
    );
  requireGlobalFormPlacementTargetBoundary(data.body!);
  await requireManagedFormPlacementTargetBoundary(requestDb(c), aggregate.form, data.body!);
  const guardedDb = guardedFormsDatabase(c, actor);
  const placement = await createManagedFormPlacement(guardedDb, actor.id, aggregate.form.id, data.body!, [
    prepareManagedFormPlacementTargetGuard(guardedDb, aggregate.form, data.body!),
  ]);
  return json(formPlacementCreateResponseSchema.parse({ success: true, placement }), 201);
});

export const FormPlacementUpdate = openApiRoute(formPlacementUpdateRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:write");
  const aggregate = await requireGlobalForm(requestDb(c), data.params!.formKey);
  await requireManagedFormMutationBoundary(requestDb(c), aggregate.form);
  const current = await findFormPlacement(requestDb(c), aggregate.form.id, { placementId: data.params!.placementId });
  if (!current || current.ownerGroupId !== null)
    throw new AppError(404, "FORM_PLACEMENT_NOT_FOUND", "Form placement not found");
  if (data.body!.ownerGroupId !== undefined && data.body!.ownerGroupId !== null)
    throw new AppError(
      403,
      "GROUP_FORM_MANAGEMENT_REQUIRED",
      "Group placements must be managed from the owning group context.",
    );
  const target = {
    contextType: data.body!.contextType ?? current.contextType,
    contextRef: data.body!.contextRef === undefined ? current.contextRef : data.body!.contextRef,
  };
  requireGlobalFormPlacementTargetBoundary(target);
  await requireManagedFormPlacementTargetBoundary(requestDb(c), aggregate.form, target);
  const guardedDb = guardedFormsDatabase(c, actor);
  const placement = await updateManagedFormPlacement(
    guardedDb,
    actor.id,
    aggregate.form.id,
    data.params!.placementId,
    data.body!,
    null,
    [],
    (next) => [prepareManagedFormPlacementTargetGuard(guardedDb, aggregate.form, next)],
  );
  return json(formPlacementCreateResponseSchema.parse({ success: true, placement }));
});
