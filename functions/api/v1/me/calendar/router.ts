import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MeCalendarGet } from "./index";
import { MeCalendarPreferencePatch } from "./[seriesId]/preference";
import { MeCalendarDownloadGet } from "./[seriesId]/[icsFileId]";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MeCalendarGet);
openapi.patch("/:seriesId/preference", MeCalendarPreferencePatch);
openapi.get("/:seriesId/:icsFileId", MeCalendarDownloadGet);

export default openapi;
