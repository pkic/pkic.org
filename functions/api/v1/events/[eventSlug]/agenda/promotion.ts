import {
  requestPromotionRender,
  processPromotionRenderJob,
} from "../../../../../_lib/services/event-agenda/promotion-render-jobs";
import { promotionFormatSchema } from "../../../../../../assets/shared/schemas/event-promotion-kit";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import {
  assignedPromotionKit,
  listAssignedPromotionSessions,
  recordPromotionDownload,
} from "../../../../../_lib/services/event-agenda/promotion-access";
import {
  promotionKitGetRouteSchema,
  promotionRendersCreateRouteSchema,
  promotionSessionsGetRouteSchema,
  promotionCopySaveRouteSchema,
  promotionArtifactGetRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireEventPermission } from "../authorization";
import { resolveUserSessionFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { hasPermission, guardPermissionDatabase } from "../../../../../_lib/auth/permissions";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { AppError } from "../../../../../_lib/errors";
import { savePromotionCopy } from "../../../../../_lib/services/event-agenda/promotion-kit";
async function ownKit(c: AdminContext, eventSlug: string, occurrenceId: string) {
  const db = requestDb(c);
  const session = await resolveUserSessionFromRequest(db, c.req.raw, {
    INTERNAL_SIGNING_SECRET: c.env.INTERNAL_SIGNING_SECRET,
  });
  const actor = session.staff;
  const userId = session.identity.id;
  const event = await getEventBySlug(db, eventSlug);
  return {
    ...(await assignedPromotionKit(
      db,
      event.id,
      occurrenceId,
      userId,
      Boolean(actor && hasPermission(actor, "agenda:write", { type: "event", id: event.id })),
      resolveAppBaseUrl(c.env, c.req.raw),
    )),
    eventId: event.id,
  };
}
export const PromotionKitGet = openApiRoute(promotionKitGetRouteSchema, async (c, data) =>
  json((await ownKit(c, data.params.eventSlug, data.params.occurrenceId)).kit),
);
export const PromotionCopySave = openApiRoute(promotionCopySaveRouteSchema, async (c, data) => {
  const { db, event, actor, context } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "agenda:write", context }],
    () => new AppError(409, "AGENDA_AUTHORIZATION_CHANGED", "Agenda permission changed"),
  );
  return json(
    await savePromotionCopy(
      guarded,
      event.id,
      event.slug,
      data.params.occurrenceId,
      data.body.expectedRevision,
      data.body.copy,
      actor.id,
    ),
  );
});
export const PromotionArtifactGet = openApiRoute(promotionArtifactGetRouteSchema, async (c, data) => {
  const source = await ownKit(c, data.params.eventSlug, data.params.occurrenceId);
  if (source.kit.publishedRevision !== data.query.revision)
    throw new AppError(409, "PROMOTION_ARTIFACT_STALE", "The agenda changed. Refresh your kit before downloading.");
  const format = data.query.format;
  const job = await requestPromotionRender(
    requestDb(c),
    source.eventId,
    source,
    format,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  let cached = await c.env.ASSETS_BUCKET.get(job.cache_key);
  if (!cached) {
    await processPromotionRenderJob(requestDb(c), c.env, job.id);
    cached = await c.env.ASSETS_BUCKET.get(job.cache_key);
  }
  if (!cached)
    throw new AppError(
      409,
      "PROMOTION_RENDER_PENDING",
      "Your promotion material is being prepared. Refresh the kit shortly; failed renders retry automatically.",
    );
  if (
    data.query.download === "false" &&
    format !== "carousel" &&
    cached.httpMetadata?.contentType === "application/zip"
  ) {
    cached = await c.env.ASSETS_BUCKET.get(`${job.cache_key}.preview.png`);
    if (!cached) throw new AppError(409, "PROMOTION_PREVIEW_PENDING", "Preview is being prepared. Refresh shortly.");
  }
  if (data.query.download === "true")
    await recordPromotionDownload(requestDb(c), data.params.occurrenceId, source.actorId, format);
  return new Response(cached.body, {
    headers: {
      "content-type": cached.httpMetadata?.contentType ?? (format === "carousel" ? "application/pdf" : "image/png"),
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="session-${format}.${cached.httpMetadata?.contentType === "application/zip" ? "zip" : format === "carousel" ? "pdf" : "png"}"`,
    },
  });
});
export const PromotionRendersCreate = openApiRoute(promotionRendersCreateRouteSchema, async (c, data) => {
  const source = await ownKit(c, data.params.eventSlug, data.params.occurrenceId);
  const jobs = [];
  for (const format of promotionFormatSchema.options)
    jobs.push(
      await requestPromotionRender(requestDb(c), source.eventId, source, format, resolveAppBaseUrl(c.env, c.req.raw)),
    );
  c.executionCtx.waitUntil(
    (async () => {
      for (const job of jobs) await processPromotionRenderJob(requestDb(c), c.env, job.id);
    })(),
  );
  return json((await ownKit(c, data.params.eventSlug, data.params.occurrenceId)).kit);
});

export const PromotionSessionsGet = openApiRoute(promotionSessionsGetRouteSchema, async (c, data) => {
  const db = requestDb(c);
  const session = await resolveUserSessionFromRequest(db, c.req.raw, {
    INTERNAL_SIGNING_SECRET: c.env.INTERNAL_SIGNING_SECRET,
  });
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(await listAssignedPromotionSessions(db, event.id, session.identity.id, data.query));
});
