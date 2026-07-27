import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ApplicationDetailGet } from "./index";
import { ApplicationStagePatch } from "./stage";
import { ApplicationCommunicationsPost } from "./communications";
import { ApplicationNotesPost } from "./notes";
import { AdminApplicationDocumentsGet } from "./documents";
import { AdminApplicationEcDecisionsPost } from "./ec-decisions";
import { ApplicationApprovePost } from "./approve";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", ApplicationDetailGet);
openapi.patch("/stage", ApplicationStagePatch);
openapi.post("/communications", ApplicationCommunicationsPost);
openapi.post("/notes", ApplicationNotesPost);
openapi.get("/documents", AdminApplicationDocumentsGet);
openapi.post("/ec-decisions", AdminApplicationEcDecisionsPost);
openapi.post("/approve", ApplicationApprovePost);

export default openapi;
