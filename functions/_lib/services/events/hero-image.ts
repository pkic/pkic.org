import type { EventHeroVariantWidth } from "../../../../assets/shared/event-hero-image-variants";
import { storedRasterRenditionResponse } from "../raster-image-renditions";
import type { EventHeroImageSave } from "../../../../assets/shared/schemas/event-hero-image";
import {
  EVENT_HERO_IMAGE_MAX_BYTES,
  eventHeroImageDimensionsSchema,
} from "../../../../assets/shared/schemas/event-hero-image";
import { guardPermissionDatabase, hasPermission, requirePermission } from "../../auth/permissions";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { imageExtension, putUploadedImage, readValidatedUploadedImage } from "../../utils/image-upload";
import { parseJsonSafe } from "../../utils/json";
import { isAuditChangeGuardFailure } from "../audit";
import { getEventBySlug } from "../events";
import { guardEventResourceManagementDatabase } from "../event-series/management";
import { withStorageUploadCompensation } from "../storage-deletion-outbox";
import { prepareEventDetail, decodeEventDetail, type EventDetailRow } from "./detail";
import { batchFirst } from "../../db/pagination";
import { prepareUserBackedAdminFromRequest } from "../../auth/admin";
import { prepareGroupEventSettingsAccess } from "./group-settings-detail";
import {
  prepareDirectEventConfigurationGuard,
  assertDirectEventConfiguration,
  throwEventConfigurationConflict,
} from "./direct-configuration";
import { buildEventSettingsMutationStatements } from "./settings";

import { eventHeroImageKey } from "../../utils/event-hero-image";

export async function saveEventHeroImage(
  db: DatabaseLike,
  env: Env,
  slug: string,
  input: EventHeroImageSave,
  request: Request,
  appBaseUrl: string,
) {
  const auth = await prepareUserBackedAdminFromRequest(db, request, env);
  if (!auth) throw new AppError(403, "USER_REQUIRED", "A signed-in user is required");
  const access = input.groupId
    ? prepareGroupEventSettingsAccess(db, auth.permissionActor, input.groupId, slug, auth.memberSelection)
    : null;
  const loaded = await db.batch([...auth.statements, ...(access?.statements ?? []), prepareEventDetail(db, slug)]);
  const actor = await auth.decode(loaded.slice(0, auth.statements.length));
  const event = batchFirst<EventDetailRow>(loaded.at(-1)!);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const selectedGroup = access?.decode(loaded.slice(auth.statements.length));
  let guardedDb: DatabaseLike;
  if (input.groupId) {
    const context = { groupId: selectedGroup!, eventId: event.id };
    guardedDb = guardEventResourceManagementDatabase(db, actor, context, "manage");
  } else {
    const context = { type: "event", id: event.id };
    requirePermission(actor, "events:write", context);
    assertDirectEventConfiguration(event, event.series_id);
    guardedDb = guardPermissionDatabase(
      db,
      actor,
      [{ permission: "events:write", context }],
      () => new AppError(403, "PERMISSION_REQUIRED", "Event editing permission changed"),
    );
  }
  const bucket = env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Image storage is not configured");
  const image = await readValidatedUploadedImage(request, "Hero image", EVENT_HERO_IMAGE_MAX_BYTES);
  const dimensions = eventHeroImageDimensionsSchema.safeParse(image);
  if (!dimensions.success) {
    const messages = dimensions.error.issues.map((issue) => issue.message);
    throw new AppError(422, "VALIDATION_ERROR", messages[0], { formErrors: [], fieldErrors: { file: messages } });
  }
  const file = `${crypto.randomUUID()}.${imageExtension(image.contentType)}`;
  const key = `event-images/${event.id}/${file}`;
  const nextSlug = input.slug ?? slug;
  const heroImageUrl = `/api/v1/events/${encodeURIComponent(nextSlug)}/images/${file}`;
  const { groupId, ...settings } = input;
  const statements = [
    prepareAuthorizationGuard(guardedDb, auth.authorizationEvidence),
    input.groupId
      ? prepareAuthorizationGuard(guardedDb, {
          sql: `SELECT 1 FROM events e WHERE e.id = ? AND COALESCE(e.profile_key, '') NOT IN ('meeting', 'board_meeting')
            AND NOT EXISTS (SELECT 1 FROM event_series s WHERE s.event_id = e.id)`,
          bindings: [event.id],
        })
      : prepareDirectEventConfigurationGuard(guardedDb, event.id),
    ...buildEventSettingsMutationStatements(guardedDb, {
      event,
      actorId: actor.id,
      settings: { ...settings, heroImageUrl },
      expectedUpdatedAt: input.expectedUpdatedAt,
      appBaseUrl,
      auditScope: groupId ? { type: "group", id: selectedGroup! } : { type: "event", id: event.id },
    }),
    prepareEventDetail(guardedDb, nextSlug),
  ];
  let responseRow: EventDetailRow | null = null;
  try {
    const committed = await withStorageUploadCompensation({
      db: guardedDb,
      bucket,
      bucketName: "assets",
      objectKey: key,
      upload: () => putUploadedImage(bucket, key, image, "hero image"),
      prepareCommitStatements: () => statements,
    });
    responseRow = batchFirst<EventDetailRow>(committed[statements.length - 1]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error))
      throw new AppError(409, "EVENT_CHANGED", "The event changed; reload before saving");
    throwEventConfigurationConflict(error);
  }
  if (!responseRow) throw new AppError(500, "EVENT_RESPONSE_MISSING", "Saved event could not be read");
  return decodeEventDetail(
    responseRow,
    groupId
      ? ["read"]
      : (["read", "write", "manage"] as const).filter((capability) =>
          hasPermission(actor, `events:${capability}`, { type: "event", id: event.id }),
        ),
  );
}

/** Like current portraits, the image asset requires its unguessable filename and current D1 pointer. */
export async function currentEventHeroImage(
  db: DatabaseLike,
  env: Pick<Env, "ASSETS_BUCKET" | "IMAGES">,
  slug: string,
  file: string,
  rendition?: { width: EventHeroVariantWidth; origin: string },
) {
  const event = await getEventBySlug(db, slug);
  const path = `/api/v1/events/${encodeURIComponent(slug)}/images/${file}`;
  const settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
  if (settings.heroImageUrl !== path) throw new AppError(404, "IMAGE_NOT_FOUND", "Image not found");
  const key = eventHeroImageKey(event.id, slug, path);
  if (rendition && key && env.ASSETS_BUCKET) {
    const response = await storedRasterRenditionResponse({
      bucket: env.ASSETS_BUCKET,
      storedKey: key,
      ownerId: event.id,
      namespace: "event-hero-renditions",
      width: Number(rendition.width),
      fit: "scale-down",
      images: env.IMAGES,
      origin: rendition.origin,
      cacheControl: "no-store",
      maxSourceBytes: EVENT_HERO_IMAGE_MAX_BYTES,
      notFound: { notFoundCode: "IMAGE_NOT_FOUND", notFoundMessage: "Image not found" },
    });
    response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  }
  const object = key ? await env.ASSETS_BUCKET?.get(key) : null;
  if (!object) throw new AppError(404, "IMAGE_NOT_FOUND", "Image not found");
  return new Response(object.body as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
