import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../../_lib/db/context";
import { EventFormDelete, EventFormGet, EventFormPatch } from "./index";
import { EventFormSubmissionStatsGet } from "./submission-stats";
import { EventFormSubmissionsGet } from "./submissions";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);
openapi.get("/", EventFormGet);
openapi.patch("/", EventFormPatch);
openapi.delete("/", EventFormDelete);
openapi.get("/submissions", EventFormSubmissionsGet);
openapi.get("/submissions/stats", EventFormSubmissionStatsGet);
export default openapi;
