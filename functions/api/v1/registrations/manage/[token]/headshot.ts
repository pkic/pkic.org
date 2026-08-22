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
 *  - They own or have a royalty-free license to the image
 *  - They accept full liability
 */

import { OpenAPIRoute } from "chanfana";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { resolveManageToken } from "../../../../../_lib/services/manage-token";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import {
  REGISTRATION_HEADSHOT_MAX_BYTES,
  registrationHeadshotDeleteRouteSchema,
  registrationHeadshotUploadRouteSchema,
} from "../../../../../../assets/shared/schemas/registration";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { readBoundedImageMultipartFormData, validateUploadedImageFile } from "../../../../../_lib/utils/image-upload";
import {
  getUserHeadshotRecord,
  publicUserHeadshotUrl,
  removeUserHeadshotForRequest,
  uploadUserHeadshotForRequest,
} from "../../../../../_lib/services/user-headshot";

// ── PUT — upload / replace headshot ──────────────────────────────────────────

async function onPut(c: AdminContext, token: string): Promise<Response> {
  const resolved = await resolveManageToken(c.req.raw, c.env, token);
  if (resolved instanceof Response) return resolved;
  const { registration } = resolved;

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

  const user = await getUserHeadshotRecord(requestDb(c), registration.user_id);

  const { r2Key, origin: appOrigin } = await uploadUserHeadshotForRequest(
    requestDb(c),
    c.env,
    c.req.raw,
    c.executionCtx.waitUntil.bind(c.executionCtx),
    {
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
    },
  );
  const headshotUrl = publicUserHeadshotUrl(appOrigin, r2Key);
  if (!headshotUrl) throw new Error("Generated headshot key is not publicly addressable");

  return json({ success: true, headshotUrl });
}

// ── DELETE — remove headshot ──────────────────────────────────────────────────

async function onDelete(c: AdminContext, token: string): Promise<Response> {
  const resolved = await resolveManageToken(c.req.raw, c.env, token);
  if (resolved instanceof Response) return resolved;
  const { registration } = resolved;

  const user = await getUserHeadshotRecord(requestDb(c), registration.user_id);

  await removeUserHeadshotForRequest(requestDb(c), c.env, c.req.raw, c.executionCtx.waitUntil.bind(c.executionCtx), {
    userId: user.id,
    previousKey: user.headshot_r2_key,
    audit: {
      actorType: "user",
      actorId: user.id,
      action: "headshot_deleted_by_attendee",
      details: { registrationId: registration.id },
    },
  });

  return json({ success: true });
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, {
    PUT: (context) => onPut(context, context.req.param("token")),
    DELETE: (context) => onDelete(context, context.req.param("token")),
  });
}

// PUT stays a manual OpenAPIRoute (not openApiRoute-wrapped): the schema's
// body is multipart/form-data (registrationHeadshotUploadFormSchema is
// documentation-only for that content type — chanfana can't validate it),
// and onPut reads the bounded multipart body itself. Routing
// this through openApiRoute would make chanfana's getValidatedData() touch
// the request body before the handler's own formData() read runs.
export class RegistrationsManageTokenHeadshotPut extends OpenAPIRoute {
  schema = registrationHeadshotUploadRouteSchema;

  async handle(c: AdminContext) {
    return onPut(c, c.req.param("token"));
  }
}

export const RegistrationsManageTokenHeadshotDelete = openApiRoute(registrationHeadshotDeleteRouteSchema, (c, data) =>
  onDelete(c, data.params.token),
);
