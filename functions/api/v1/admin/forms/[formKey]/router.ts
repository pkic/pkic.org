import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminFormsFormKeyGet } from "./index";
import { AdminFormsFormKeyPatch } from "./index";
import { AdminFormsFormKeyDelete } from "./index";
import { AdminFormsFormKeySubmissionsGet } from "./submissions";
import { AdminFormsFormKeySubmissionStatsGet } from "./submission-stats";
import { AdminFormPlacementCreate, AdminFormPlacementsList, AdminFormPlacementUpdate } from "./placements";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", AdminFormsFormKeyGet);
openapi.patch("/", AdminFormsFormKeyPatch);
openapi.delete("/", AdminFormsFormKeyDelete);
openapi.get("/submissions", AdminFormsFormKeySubmissionsGet);
openapi.get("/submissions/stats", AdminFormsFormKeySubmissionStatsGet);
openapi.get("/placements", AdminFormPlacementsList);
openapi.post("/placements", AdminFormPlacementCreate);
openapi.patch("/placements/:placementId", AdminFormPlacementUpdate);

export default openapi;
