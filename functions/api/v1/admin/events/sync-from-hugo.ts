import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { replaceEventTerms, upsertEventFromHugo } from "../../../../_lib/services/events";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { adminEventSyncSchema } from "../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventSyncSchema);

  const settings = {
    ...(body.event.settings ?? {}),
    ...(body.event.frontend ? { frontend: body.event.frontend } : {}),
  };

  const event = await upsertEventFromHugo(requestDb(c), {
    ...body.event,
    settings,
  });

  if (body.terms) {
    await replaceEventTerms(requestDb(c), event.id, "attendee", body.terms.attendee);
    await replaceEventTerms(requestDb(c), event.id, "speaker", body.terms.speaker);
  }

  await writeAuditLog(requestDb(c), "admin", admin.id, "event_synced_from_hugo", "event", event.id, {
    slug: event.slug,
  });

  return json({ success: true, event });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
