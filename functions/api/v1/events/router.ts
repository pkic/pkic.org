import { Hono } from "hono";
import { fromHono } from "chanfana";
import eventSlug_Router from "./[eventSlug]/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/:eventSlug", eventSlug_Router);

export default openapi;
