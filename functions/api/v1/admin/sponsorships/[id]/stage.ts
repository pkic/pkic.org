/**
 * PATCH /api/v1/admin/sponsorships/:id/stage — advance the sales pipeline
 * stage. The service commits the transition, history, audit, portal token,
 * and notification outbox rows as one D1 batch; this route only schedules
 * delivery after that durable unit succeeds.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getConfig } from "../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { advanceSponsorshipStage, toApiSponsorship } from "../../../../../_lib/services/sponsorship";
import { sponsorshipStageUpdateRouteSchema } from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const SponsorshipStageUpdate = openApiRoute(sponsorshipStageUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const body = data.body;
  const id = data.params.id;
  const config = getConfig(c.env, c.req.raw);
  const result = await advanceSponsorshipStage(db, {
    id,
    toStage: body.toStage,
    actor: admin,
    note: body.note ?? null,
    notifications: {
      appBaseUrl: config.appBaseUrl,
      magicLinkTtlMinutes: config.magicLinkTtlMinutes,
    },
  });

  for (const outboxId of result.outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json({ sponsorship: toApiSponsorship(result.sponsorship) });
});
