import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listProposalsForEvent } from "../../../../../_lib/services/proposals";
import type { PagesContext } from "../../../../../_lib/types";

export async function onRequestGet(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const proposals = await listProposalsForEvent(context.env.DB, event.id);
  return json({ event: { id: event.id, slug: event.slug, name: event.name }, proposals });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(context);
}
