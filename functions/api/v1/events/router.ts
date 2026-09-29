import { Hono } from "hono";
import { fromHono } from "chanfana";
import eventSlug_Router from "./[eventSlug]/router";
import { EventsListGet } from "./index";
import { EventImportsCreate } from "./imports/index";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", EventsListGet);
// Reserved collection segments are registered before the event-slug router so
// they cannot be captured as a slug, matching the groups router convention.
openapi.post("/imports", EventImportsCreate);
openapi.route("/:eventSlug", eventSlug_Router);

export default openapi;
