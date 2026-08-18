import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { getCachedAdminForRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { requestDb } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { onRequestGet as AdminEventsEventSlugDaysGet_l } from "./days";
import { onRequestPut as AdminEventsEventSlugDaysPut_l } from "./days";
import { onRequestGet as AdminEventsEventSlugFormsGet_l } from "./forms";
import { onRequestPost as AdminEventsEventSlugFormsPost_l } from "./forms";
import { onRequestGet as AdminEventsEventSlugGet_l } from "./index";
import { onRequestGet as AdminEventsEventSlugPermissionsGet_l } from "./permissions";
import { onRequestPost as AdminEventsEventSlugPermissionsPost_l } from "./permissions";
import { onRequestGet as AdminEventsEventSlugPromotersGet_l } from "./promoters";
import { onRequestGet as AdminEventsEventSlugPresentationsDownloadGet_l } from "./presentations/download";
import { AdminEventsEventSlugProposalsGet } from "./proposals";
import { AdminEventRegistrationsGet } from "./registrations";
import { onRequestPatch as AdminEventsEventSlugSettingsPatch_l } from "./settings";
import { onRequestGet as AdminEventsEventSlugSponsorTiersGet_l } from "./sponsor-tiers";
import { onRequestPut as AdminEventsEventSlugSponsorTiersPut_l } from "./sponsor-tiers";
import { onRequestGet as AdminEventsEventSlugStatsGet_l } from "./stats";
import { onRequestGet as AdminEventsEventSlugTermsGet_l } from "./terms";
import { onRequestPut as AdminEventsEventSlugTermsPut_l } from "./terms";
import emails_Router from "./emails/router";
import invites_Router from "./invites/router";
import permissions_Router from "./permissions/router";
import registrations_Router from "./registrations/router";
import waitlist_Router from "./waitlist/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isSelfGatedEventPath(path: string, eventSlug: string): boolean {
  const marker = `/events/${eventSlug}/`;
  const idx = path.indexOf(marker);
  if (idx === -1) return false;
  const rest = path.slice(idx + marker.length);
  return rest.startsWith("proposals") || rest.startsWith("permissions");
}

/**
 * Context-aware gate for the /admin/events/:eventSlug/**
 * management surface (registrations, invites, waitlist, settings, emails,
 * days, forms, terms, promoters, stats) — requires events:read (GET) or
 * events:write (writes), globally or scoped to this event. Global admins
 * pass unconditionally via requirePermission's role='admin' bypass, so
 * existing behavior under the single-tier admin model is unchanged; this
 * is what actually gives a event_organizer grant "full management
 * of a specific event" (P7) instead of just admin-only access.
 *
 * `/proposals` and `/permissions` are excluded here — they self-gate with
 * finer-grained permissions (proposals:read/score/manage, events:manage)
 * in their own handlers, since a program_committee grant authorizes
 * proposal/agenda access without granting general event management.
 */
async function requireEventManagementAccess(c: Context<RequestDbContext>, next: Next): Promise<void> {
  const eventSlug = c.req.param("eventSlug") ?? "";
  if (isSelfGatedEventPath(c.req.path, eventSlug)) {
    await next();
    return;
  }

  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing authenticated admin");
  }

  const event = await getEventBySlug(requestDb(c), eventSlug);
  const permission = WRITE_METHODS.has(c.req.method) ? "events:write" : "events:read";
  requirePermission(admin, permission, { type: "event", id: event.id });

  await next();
}

app.use("*", requireEventManagementAccess);

app.get("/days", AdminEventsEventSlugDaysGet_l);
app.put("/days", AdminEventsEventSlugDaysPut_l);
app.get("/forms", AdminEventsEventSlugFormsGet_l);
app.post("/forms", AdminEventsEventSlugFormsPost_l);
app.get("/", AdminEventsEventSlugGet_l);
app.get("/permissions", AdminEventsEventSlugPermissionsGet_l);
app.post("/permissions", AdminEventsEventSlugPermissionsPost_l);
app.get("/promoters", AdminEventsEventSlugPromotersGet_l);
app.get("/presentations/download", AdminEventsEventSlugPresentationsDownloadGet_l);
openapi.get("/proposals", AdminEventsEventSlugProposalsGet);
openapi.get("/registrations", AdminEventRegistrationsGet);
app.patch("/settings", AdminEventsEventSlugSettingsPatch_l);
app.get("/sponsor-tiers", AdminEventsEventSlugSponsorTiersGet_l);
app.put("/sponsor-tiers", AdminEventsEventSlugSponsorTiersPut_l);
app.get("/stats", AdminEventsEventSlugStatsGet_l);
app.get("/terms", AdminEventsEventSlugTermsGet_l);
app.put("/terms", AdminEventsEventSlugTermsPut_l);
openapi.route("/emails", emails_Router);
openapi.route("/invites", invites_Router);
openapi.route("/permissions", permissions_Router);
openapi.route("/registrations", registrations_Router);
openapi.route("/waitlist", waitlist_Router);

export default openapi;
