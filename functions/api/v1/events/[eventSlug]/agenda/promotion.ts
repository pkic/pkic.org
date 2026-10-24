import { eventPromotionSessionsGetRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import { promotionRenderStatus } from "../../../../../_lib/services/event-agenda/promotion-render-status";
import { getAttendeePromotionKit } from "../../../../../_lib/services/event-agenda/promotion-attendee";
import { savePromotionComposition } from "../../../../../_lib/services/event-agenda/promotion-composition";
import { requireUserBackedAdminFromRequest } from "../../../../../_lib/auth/admin";
import {
  eventPromotionGetRouteSchema,
  eventPromotionCompositionSaveRouteSchema,
  eventPromotionRendersCreateRouteSchema,
  eventPromotionArtifactGetRouteSchema,
  promotionCompositionSaveRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import type { z } from "zod";
import { promotionArtifactQuerySchema } from "../../../../../../assets/shared/schemas/event-promotion-kit";
import {
  requestPromotionRender,
  processPromotionRenderJob,
} from "../../../../../_lib/services/event-agenda/promotion-render-jobs";
import { promotionFormatSchema } from "../../../../../../assets/shared/schemas/event-promotion-kit";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import {
  assignedPromotionKit,
  listPublishedPromotionSessions,
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
async function promotionActor(c: AdminContext) {
  const db = requestDb(c);
  const machine = c.req.raw.headers.get("x-pkic-machine-auth") === "mcp";
  const actor = machine ? await requireUserBackedAdminFromRequest(db, c.req.raw, c.env) : null;
  const session = machine ? null : await resolveUserSessionFromRequest(db, c.req.raw, c.env);
  const userId = actor?.id ?? session!.identity.id;
  const staff = actor ?? session?.staff;
  return { userId, staff };
}
async function ownKit(c: AdminContext, eventSlug: string, occurrenceId: string | null) {
  const db = requestDb(c),
    { userId, staff } = await promotionActor(c);
  const event = await getEventBySlug(db, eventSlug);
  return {
    ...(occurrenceId
      ? await assignedPromotionKit(
          db,
          event.id,
          occurrenceId,
          userId,
          Boolean(staff && hasPermission(staff, "agenda:write", { type: "event", id: event.id })),
          resolveAppBaseUrl(c.env, c.req.raw),
        )
      : await getAttendeePromotionKit(db, event.id, userId, resolveAppBaseUrl(c.env, c.req.raw))),
    eventId: event.id,
    eventSlug: event.slug,
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
async function download(
  c: AdminContext,
  source: Awaited<ReturnType<typeof ownKit>>,
  query: z.infer<typeof promotionArtifactQuerySchema>,
) {
  if (
    source.kit.publishedRevision !== query.revision ||
    (query.fingerprint && query.fingerprint !== source.kit.fingerprint)
  )
    throw new AppError(409, "PROMOTION_ARTIFACT_STALE", "The agenda changed. Refresh your kit before downloading.");
  const format = query.format;
  const job = await requestPromotionRender(
    requestDb(c),
    source.eventId,
    source,
    format,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "PROMOTION_STORAGE_UNAVAILABLE", "Promotion storage is unavailable.");
  let cached = await bucket.get(job.cache_key);
  if (!cached) {
    await processPromotionRenderJob(requestDb(c), c.env, job.id);
    cached = await bucket.get(job.cache_key);
  }
  if (!cached)
    throw new AppError(
      409,
      "PROMOTION_RENDER_PENDING",
      "Your promotion material is being prepared. Refresh the kit shortly; failed renders retry automatically.",
    );
  const current = await ownKit(c, source.eventSlug, source.kit.occurrenceId);
  const statuses = await promotionRenderStatus(
    requestDb(c),
    source.eventId,
    source.actorId,
    source.kit.occurrenceId,
    source.kit.fingerprint!,
  );
  if (
    current.kit.fingerprint !== source.kit.fingerprint ||
    !statuses.some((item) => item.format === format && item.status === "rendered")
  )
    throw new AppError(409, "PROMOTION_ARTIFACT_STALE", "Your materials changed. Refresh your kit before downloading.");
  if (query.download === "false" && format !== "carousel" && cached.httpMetadata?.contentType === "application/zip") {
    cached = await bucket.get(`${job.cache_key}.preview.png`);
    if (!cached) throw new AppError(409, "PROMOTION_PREVIEW_PENDING", "Preview is being prepared. Refresh shortly.");
  }
  if (query.download === "true")
    await recordPromotionDownload(requestDb(c), source.kit.occurrenceId, source.actorId, format, job.id);
  return new Response(cached.body, {
    headers: {
      "content-type": cached.httpMetadata?.contentType ?? (format === "carousel" ? "application/pdf" : "image/png"),
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="session-${format}.${cached.httpMetadata?.contentType === "application/zip" ? "zip" : format === "carousel" ? "pdf" : "png"}"`,
    },
  });
}
async function queueRenders(c: AdminContext, source: Awaited<ReturnType<typeof ownKit>>) {
  for (const format of promotionFormatSchema.options)
    await requestPromotionRender(requestDb(c), source.eventId, source, format, resolveAppBaseUrl(c.env, c.req.raw));
  const preview = await requestPromotionRender(
    requestDb(c),
    source.eventId,
    source,
    "portrait",
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  c.executionCtx.waitUntil(processPromotionRenderJob(requestDb(c), c.env, preview.id));
  source.kit.artifacts = await promotionRenderStatus(
    requestDb(c),
    source.eventId,
    source.actorId,
    source.kit.occurrenceId,
    source.kit.fingerprint!,
  );
  return json(source.kit);
}
export const PromotionArtifactGet = openApiRoute(promotionArtifactGetRouteSchema, async (c, data) =>
  download(c, await ownKit(c, data.params.eventSlug, data.params.occurrenceId), data.query),
);
export const PromotionRendersCreate = openApiRoute(promotionRendersCreateRouteSchema, async (c, data) =>
  queueRenders(c, await ownKit(c, data.params.eventSlug, data.params.occurrenceId)),
);
async function saveOwn(
  c: AdminContext,
  slug: string,
  occurrenceId: string | null,
  input: Parameters<typeof savePromotionComposition>[4],
) {
  const source = await ownKit(c, slug, occurrenceId);
  await savePromotionComposition(
    requestDb(c),
    source.eventId,
    source.actorId,
    occurrenceId,
    input,
    source.agenda.occurrences
      .filter((item) => item.visibility === "public" && item.kind !== "break")
      .map((item) => item.id),
  );
  return json((await ownKit(c, slug, occurrenceId)).kit);
}
export const PromotionCompositionSave = openApiRoute(promotionCompositionSaveRouteSchema, async (c, data) =>
  saveOwn(c, data.params.eventSlug, data.params.occurrenceId, data.body),
);
export const EventPromotionGet = openApiRoute(eventPromotionGetRouteSchema, async (c, data) =>
  json((await ownKit(c, data.params.eventSlug, null)).kit),
);
export const EventPromotionCompositionSave = openApiRoute(eventPromotionCompositionSaveRouteSchema, async (c, data) =>
  saveOwn(c, data.params.eventSlug, null, data.body),
);
export const EventPromotionRendersCreate = openApiRoute(eventPromotionRendersCreateRouteSchema, async (c, data) =>
  queueRenders(c, await ownKit(c, data.params.eventSlug, null)),
);
export const EventPromotionArtifactGet = openApiRoute(eventPromotionArtifactGetRouteSchema, async (c, data) =>
  download(c, await ownKit(c, data.params.eventSlug, null), data.query),
);

export const PromotionSessionsGet = openApiRoute(promotionSessionsGetRouteSchema, async (c, data) => {
  const db = requestDb(c);
  const { userId } = await promotionActor(c);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(await listPublishedPromotionSessions(db, event.id, userId, data.query));
});

export const EventPromotionSessionsGet = openApiRoute(eventPromotionSessionsGetRouteSchema, async (c, data) => {
  const source = await ownKit(c, data.params.eventSlug, null);
  return json(await listPublishedPromotionSessions(requestDb(c), source.eventId, null, data.query));
});
