import { Hono } from "hono";
import { fromHono } from "chanfana";
import { FormsDelete, FormsGet, FormsPatch } from "./index";
import { FormsFormKeySubmissionsGet } from "./submissions";
import { FormsFormKeySubmissionStatsGet } from "./submission-stats";
import { FormPlacementCreate, FormPlacementsList, FormPlacementUpdate } from "./placements";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);
openapi.get("/", FormsGet);
openapi.patch("/", FormsPatch);
openapi.delete("/", FormsDelete);
openapi.get("/submissions", FormsFormKeySubmissionsGet);
openapi.get("/submissions/stats", FormsFormKeySubmissionStatsGet);
openapi.get("/placements", FormPlacementsList);
openapi.post("/placements", FormPlacementCreate);
openapi.patch("/placements/:placementId", FormPlacementUpdate);
export default openapi;
