import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ApplicationDetailGet, ApplicationDetailPatch } from "./index";
import { ApplicationStagePatch } from "./stage";
import { ApplicationCommunicationsPost } from "./communications";
import { ApplicationNotesPost } from "./notes";
import { StaffApplicationDocumentsGet } from "./documents";
import { MembershipApplicationEcDecisionsPost } from "./ec-decisions";
import { ApplicationApprovePost } from "./approve";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", ApplicationDetailGet);
openapi.patch("/", ApplicationDetailPatch);
openapi.patch("/stage", ApplicationStagePatch);
openapi.post("/communications", ApplicationCommunicationsPost);
openapi.post("/notes", ApplicationNotesPost);
openapi.get("/documents", StaffApplicationDocumentsGet);
openapi.post("/ec-decisions", MembershipApplicationEcDecisionsPost);
openapi.post("/approve", ApplicationApprovePost);

export default openapi;
