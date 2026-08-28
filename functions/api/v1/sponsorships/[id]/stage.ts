/**
 * PATCH /api/v1/sponsorships/:id/stage — advance the sales pipeline
 * stage. The service commits the transition, history, audit, portal token,
 * and notification outbox rows as one D1 batch; this route only schedules
 * delivery after that durable unit succeeds.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { getConfig } from "../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import {
  advanceSponsorshipStage,
  authorizedSponsorshipMutationDb,
  toApiSponsorship,
} from "../../../../_lib/services/sponsorship";
import { sponsorshipStageUpdateRouteSchema } from "../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireInternalSecret } from "../../../../_lib/request";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const SponsorshipStageUpdate = openApiRoute(sponsorshipStageUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");

  const body = data.body;
  const id = data.params.id;
  const config = getConfig(c.env, c.req.raw);
  const result = await advanceSponsorshipStage(authorizedSponsorshipMutationDb(db, staff), {
    id,
    toStage: body.toStage,
    actor: staff,
    note: body.note ?? null,
    notifications: {
      appBaseUrl: config.appBaseUrl,
      magicLinkTtlMinutes: config.magicLinkTtlMinutes,
      signingSecret: requireInternalSecret(c.env),
    },
  });

  for (const outboxId of result.outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json({ sponsorship: toApiSponsorship(result.sponsorship) });
});
