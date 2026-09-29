import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { SchedulerJobScheduleUpdate } from "./jobs/[jobKey]/schedule";
import { SchedulerJobsList } from "./jobs/index";
import { SchedulerJobStateUpdate } from "./jobs/[jobKey]/index";
import { SchedulerJobRunCreate } from "./jobs/[jobKey]/runs/index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/jobs", SchedulerJobsList);
openapi.patch("/jobs/:jobKey", SchedulerJobStateUpdate);
openapi.patch("/jobs/:jobKey/schedule", SchedulerJobScheduleUpdate);
openapi.post("/jobs/:jobKey/runs", SchedulerJobRunCreate);

export default openapi;
