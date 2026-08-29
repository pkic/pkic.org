import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersApplicationsStatusGet } from "./status";
import { MembersApplicationsDocumentsPost, MembersApplicationsDocumentsGet } from "./documents";
import { MembersApplicationsConcernsPost } from "./concerns";
import { ApplicationDetailGet, ApplicationDetailPatch } from "./index";
import { ApplicationStagePatch } from "./stage";
import { ApplicationCommunicationsPost } from "./communications";
import { ApplicationNotesPost } from "./notes";
import { MembershipApplicationEcDecisionsPost } from "./ec-decisions";
import { ApplicationApprovePost } from "./approve";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/status", MembersApplicationsStatusGet);
openapi.post("/documents", MembersApplicationsDocumentsPost);
openapi.get("/documents", MembersApplicationsDocumentsGet);
openapi.post("/concerns", MembersApplicationsConcernsPost);
openapi.get("/", ApplicationDetailGet);
openapi.patch("/", ApplicationDetailPatch);
openapi.patch("/stage", ApplicationStagePatch);
openapi.post("/communications", ApplicationCommunicationsPost);
openapi.post("/notes", ApplicationNotesPost);
openapi.post("/ec-decisions", MembershipApplicationEcDecisionsPost);
openapi.post("/approve", ApplicationApprovePost);

export default openapi;
