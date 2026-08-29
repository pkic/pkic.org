/**
 * PATCH /api/v1/members/applications/:id/stage — stage transition.
 *
 * The use case commits transition, history, audit, and outbox atomically;
 * this route only authorizes, supplies request/config data, and schedules
 * delivery after commit.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { getConfig } from "../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { getMembershipSettings } from "../../../../../_lib/services/membership-settings";
import { transitionApplicationStage } from "../../../../../_lib/services/membership/applications/transition";
import {
  applicationStageTransitionResponseSchema,
  applicationStageTransitionRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const ApplicationStagePatch = openApiRoute(
  applicationStageTransitionRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");

    const body = data.body;
    const applicationId = data.params.id;

    const config = getConfig(c.env, c.req.raw);
    const settings = await getMembershipSettings(db);
    const result = await transitionApplicationStage(db, {
      applicationId,
      toStage: body.toStage,
      actor: staff,
      onHoldSubtype: body.onHoldSubtype ?? null,
      note: body.note ?? null,
      notification: {
        statusUrl: `${config.appBaseUrl}/application-status/?id=${applicationId}`,
        deadlineDays: settings.on_hold_response_deadline_days,
        consultationWindowDays: settings.consultation_window_days,
        requestDetails: body.note ?? "",
        reason: body.note ?? "",
      },
    });

    for (const outboxId of result.outboxIds) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
    }

    return json(
      applicationStageTransitionResponseSchema.parse({
        id: result.application.id,
        stage: result.application.stage,
        onHoldSubtype: result.application.on_hold_subtype,
      }),
    );
  },
);
