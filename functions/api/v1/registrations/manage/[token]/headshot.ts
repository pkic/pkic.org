/**
 * Attendee headshot management via registration manage token.
 *
 * PUT    /api/v1/registrations/manage/:token/headshot  — upload / replace headshot
 * DELETE /api/v1/registrations/manage/:token/headshot  — remove headshot
 *
 * Authentication is via the registration manage token (plain DB token or
 * admin-issued JWT).  No separate login session is required — the token in
 * the attendee's confirmation email is sufficient.
 *
 * The uploader must declare (via the `consent` form field) that:
 *  - The image is a photo of themselves
 *  - They own or have a royalty-free licence to the image
 *  - They accept full liability
 */

import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { resolveManageToken } from "../../../../../_lib/services/manage-token";
import { first } from "../../../../../_lib/db/queries";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import { AppError } from "../../../../../_lib/errors";
import {
  REGISTRATION_HEADSHOT_MAX_BYTES,
  registrationHeadshotDeleteRouteSchema,
  registrationHeadshotUploadRouteSchema,
} from "../../../../../../assets/shared/schemas/api";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { readBoundedImageMultipartFormData, validateUploadedImageFile } from "../../../../../_lib/utils/image-upload";
import {
  removePreviousHeadshot,
  removeUserHeadshot,
  replaceUserHeadshot,
} from "../../../../../_lib/services/user-headshot";

// ── PUT — upload / replace headshot ──────────────────────────────────────────

async function onPut(c: any): Promise<Response> {
  const resolved = await resolveManageToken(c.req.raw, c.env, c.req.param("token"));
  if (resolved instanceof Response) return resolved;
  const { registration } = resolved;

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const contentType = c.req.raw.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: { code: "INVALID_CONTENT_TYPE", message: "Request must be multipart/form-data" } }, 400);
  }

  const formData = await readBoundedImageMultipartFormData(c.req.raw, REGISTRATION_HEADSHOT_MAX_BYTES);
  const consentValue = formData.get("consent");
  if (consentValue !== "true") {
    return json(
      {
        error: {
          code: "CONSENT_REQUIRED",
          message:
            "You must confirm that the photo is of yourself, that you hold the necessary rights, and accept liability before uploading.",
        },
      },
      422,
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return json({ error: { code: "MISSING_FILE", message: 'A "file" field is required.' } }, 400);
  }

  const image = await validateUploadedImageFile(file, "Headshot", REGISTRATION_HEADSHOT_MAX_BYTES);

  // Look up the user
  const user = await first<{ id: string; headshot_r2_key: string | null }>(
    c.env.DB,
    "SELECT id, headshot_r2_key FROM users WHERE id = ?",
    [registration.user_id],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const r2Key = await replaceUserHeadshot({
    db: c.env.DB,
    bucket,
    userId: user.id,
    previousKey: user.headshot_r2_key,
    image,
    source: "attendee_self_upload",
    audit: {
      actorType: "user",
      actorId: user.id,
      action: "headshot_uploaded_by_attendee",
      details: { registrationId: registration.id },
    },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(c.env.DB, c.env, user.headshot_r2_key));

  const appOrigin = resolveAppBaseUrl(c.env, c.req.raw);
  await invalidateAndRerender(user.id, c.env, appOrigin);

  const parts = r2Key.split("/");
  const pubFilename = parts.slice(2).join("/");
  const headshotUrl = `${appOrigin}/api/v1/headshots/${user.id}/${pubFilename}`;

  return json({ success: true, headshotUrl });
}

// ── DELETE — remove headshot ──────────────────────────────────────────────────

async function onDelete(c: any, token: string): Promise<Response> {
  const resolved = await resolveManageToken(c.req.raw, c.env, token);
  if (resolved instanceof Response) return resolved;
  const { registration } = resolved;

  const user = await first<{ id: string; headshot_r2_key: string | null }>(
    c.env.DB,
    "SELECT id, headshot_r2_key FROM users WHERE id = ?",
    [registration.user_id],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  await removeUserHeadshot({
    db: c.env.DB,
    userId: user.id,
    previousKey: user.headshot_r2_key,
    audit: {
      actorType: "user",
      actorId: user.id,
      action: "headshot_deleted_by_attendee",
      details: { registrationId: registration.id },
    },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(c.env.DB, c.env, user.headshot_r2_key));

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  await invalidateAndRerender(user.id, c.env, origin);

  return json({ success: true });
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method === "PUT") return onPut(c);
  if (c.req.raw.method === "DELETE") return onDelete(c, c.req.param("token"));
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

// PUT stays a manual OpenAPIRoute (not openApiRoute-wrapped): the schema's
// body is multipart/form-data (registrationHeadshotUploadFormSchema is
// documentation-only for that content type — chanfana can't validate it),
// and onPut reads the multipart body itself via c.req.raw.formData(). Routing
// this through openApiRoute would make chanfana's getValidatedData() touch
// the request body before the handler's own formData() read runs.
export class RegistrationsManageTokenHeadshotPut extends OpenAPIRoute {
  schema = registrationHeadshotUploadRouteSchema;

  async handle(c: any) {
    return onPut(c);
  }
}

export const RegistrationsManageTokenHeadshotDelete = openApiRoute(registrationHeadshotDeleteRouteSchema, (c, data) =>
  onDelete(c, data.params.token),
);
