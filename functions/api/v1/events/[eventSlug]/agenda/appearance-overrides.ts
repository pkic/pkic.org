import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { authorize } from "./index";
import { requireEventPermission } from "../authorization";
import { hasPermission, guardPermissionDatabase } from "../../../../../_lib/auth/permissions";
import { AppError } from "../../../../../_lib/errors";
import {
  listAppearanceOverrides,
  requestAppearanceOverride,
  reviewAppearanceOverride,
} from "../../../../../_lib/services/event-agenda/appearance-overrides";
import * as contracts from "../../../../../../assets/shared/schemas/route-contracts-appearance-overrides";
export const AppearanceOverridesGet = openApiRoute(contracts.appearanceOverridesGetRouteSchema, async (c, data) => {
  const { db, event, actor, context } = await authorize(c, data.params.eventSlug, false);
  return json({
    ...(await listAppearanceOverrides(db, event.id, data.params.occurrenceId, data.query)),
    canReview: hasPermission(actor, "agenda:appearance_approve", context),
  });
});
export const AppearanceOverrideRequestPost = openApiRoute(
  contracts.appearanceOverrideRequestRouteSchema,
  async (c, data) => {
    const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
    return json(await requestAppearanceOverride(db, event.id, data.params.occurrenceId, data.body, actor.id));
  },
);
export const AppearanceOverrideReviewPost = openApiRoute(
  contracts.appearanceOverrideReviewRouteSchema,
  async (c, data) => {
    const context = await requireEventPermission(c, data.params.eventSlug, "agenda:appearance_approve");
    const db = guardPermissionDatabase(
      context.db,
      context.actor,
      [{ permission: "agenda:appearance_approve", context: context.context }],
      () => new AppError(409, "AGENDA_AUTHORIZATION_CHANGED", "Approval permission changed."),
    );
    return json(
      await reviewAppearanceOverride(
        db,
        context.event.id,
        context.event.slug,
        data.params.occurrenceId,
        data.params.requestId,
        data.body,
        context.actor.id,
      ),
    );
  },
);
