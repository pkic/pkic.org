import { Hono } from "hono";
import { fromHono } from "chanfana";
import { finalizeApiResponse, onRequest as middleware_l } from "./_middleware";
import { handleError } from "../../_lib/http";
import { onRequest as GeoGet_l } from "./geo";
import { RouteGet } from "./index";
import admin_Router from "./admin/router";
import donations_Router from "./donations/router";
import events_Router from "./events/router";
import headshots_Router from "./headshots/router";
import internal_Router from "./internal/router";
import invites_Router from "./invites/router";
import og_Router from "./og/router";
import proposals_Router from "./proposals/router";
import registrations_Router from "./registrations/router";
import webhooks_Router from "./webhooks/router";

const app = new Hono();
export const openapi = fromHono(app);

app.onError((error, c) => {
  const request = c.req.raw;
  const requestId =
    ((c as any).get("requestId") as string | undefined) ?? request.headers.get("x-request-id") ?? crypto.randomUUID();
  const sensitive = (c as any).get("sensitive") === true;
  return finalizeApiResponse(request, handleError(error), sensitive, requestId);
});
app.use("*", middleware_l);
app.get("/geo", GeoGet_l);
openapi.get("/", RouteGet);
openapi.route("/admin", admin_Router);
openapi.route("/donations", donations_Router);
openapi.route("/events", events_Router);
openapi.route("/headshots", headshots_Router);
openapi.route("/internal", internal_Router);
openapi.route("/invites", invites_Router);
openapi.route("/og", og_Router);
openapi.route("/proposals", proposals_Router);
openapi.route("/registrations", registrations_Router);
openapi.route("/webhooks", webhooks_Router);

export default openapi;
