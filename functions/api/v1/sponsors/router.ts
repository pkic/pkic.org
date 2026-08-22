import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorsDisplayGet, SponsorsGet } from "./index";
import { SponsorsIdLogoGet } from "./[id]/logo";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", SponsorsGet);
openapi.get("/display", SponsorsDisplayGet);
openapi.get("/:id/logo", SponsorsIdLogoGet);

export default openapi;
