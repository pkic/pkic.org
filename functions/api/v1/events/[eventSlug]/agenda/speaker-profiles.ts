import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { authorize } from "./index";
import { requireEventPermission } from "../authorization";
import { hasPermission, guardPermissionDatabase } from "../../../../../_lib/auth/permissions";
import { AppError } from "../../../../../_lib/errors";
import { listSpeakerProfileReviews } from "../../../../../_lib/services/event-agenda/speaker-profile-review-read";
import { approveSpeakerProfile } from "../../../../../_lib/services/event-agenda/speaker-profile-reviews";
import {
  speakerProfileReviewsRouteSchema,
  speakerProfileApprovalRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-speaker-profile-reviews";

export const SpeakerProfileReviewsGet = openApiRoute(speakerProfileReviewsRouteSchema, async (c, data) => {
  const { db, event, actor, context } = await authorize(c, data.params.eventSlug, false);
  return json({
    ...(await listSpeakerProfileReviews(db, event.id, data.query)),
    canReview: hasPermission(actor, "agenda:appearance_approve", context),
  });
});
export const SpeakerProfileApprovalPost = openApiRoute(speakerProfileApprovalRouteSchema, async (c, data) => {
  const context = await requireEventPermission(c, data.params.eventSlug, "agenda:appearance_approve");
  const db = guardPermissionDatabase(
    context.db,
    context.actor,
    [{ permission: "agenda:appearance_approve", context: context.context }],
    () => new AppError(409, "AGENDA_AUTHORIZATION_CHANGED", "Speaker profile approval permission changed."),
  );
  return json(await approveSpeakerProfile(db, context.event.id, context.event.slug, data.body, context.actor.id));
});
