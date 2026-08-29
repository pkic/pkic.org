import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { SchedulerJobsList } from "./jobs/index";
import { SchedulerJobRunCreate } from "./jobs/[jobKey]/runs/index";
import { SchedulerJobPause, SchedulerJobResume } from "./jobs/[jobKey]/pause/index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/jobs", SchedulerJobsList);
openapi.post("/jobs/:jobKey/runs", SchedulerJobRunCreate);
openapi.post("/jobs/:jobKey/pause", SchedulerJobPause);
openapi.post("/jobs/:jobKey/resume", SchedulerJobResume);

export default openapi;
