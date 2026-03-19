import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { replaceEventTerms, upsertEventFromHugo } from "../../../../_lib/services/events";
import { writeAuditLog } from "../../../../_lib/services/audit";
import type { PagesContext } from "../../../../_lib/types";
import { adminEventSyncSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request);
  const body = await parseJsonBody(context.request, adminEventSyncSchema);

  const settings = {
    ...(body.event.settings ?? {}),
    ...(body.event.frontend ? { frontend: body.event.frontend } : {}),
  };

  const event = await upsertEventFromHugo(context.env.DB, {
    ...body.event,
    settings,
  });

  if (body.terms) {
    await replaceEventTerms(context.env.DB, event.id, "attendee", body.terms.attendee);
    await replaceEventTerms(context.env.DB, event.id, "speaker", body.terms.speaker);
  }

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "event_synced_from_hugo",
    "event",
    event.id,
    { slug: event.slug },
  );

  return json({ success: true, event });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
