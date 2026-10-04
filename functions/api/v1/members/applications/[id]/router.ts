import { MembershipWorkflowReviewersGet } from "./workflow-review";
import { MembershipWorkflowMigration, MembershipWorkflowMigrationPreview } from "./workflow-migration";
import { MembershipWorkflowReviewGet, MembershipWorkflowObjectionsGet } from "./workflow-review";
import {
  MembershipStaffReviewComplete,
  MembershipObjectionCreate,
  MembershipObjectionResolve,
} from "./workflow-review";
import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersApplicationsStatusGet } from "./status";
import { MembersApplicationsDocumentsPost, MembersApplicationsDocumentsGet } from "./documents";
import { ApplicationDetailGet, ApplicationDetailPatch } from "./index";
import { ApplicationStagePatch } from "./stage";
import { ApplicationCommunicationsPost } from "./communications";
import { ApplicationNotesPost } from "./notes";
import { ApplicationApprovePost } from "./approve";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/workflow/migration", MembershipWorkflowMigrationPreview);
openapi.post("/workflow/migration", MembershipWorkflowMigration);
openapi.get("/reviews/users", MembershipWorkflowReviewersGet);
openapi.get("/reviews/current", MembershipWorkflowReviewGet);
openapi.get("/objections", MembershipWorkflowObjectionsGet);
openapi.post("/reviews/completion", MembershipStaffReviewComplete);
openapi.post("/objections", MembershipObjectionCreate);
openapi.post("/objections/:objectionId/resolution", MembershipObjectionResolve);
openapi.get("/status", MembersApplicationsStatusGet);
openapi.post("/documents", MembersApplicationsDocumentsPost);
openapi.get("/documents", MembersApplicationsDocumentsGet);
openapi.get("/", ApplicationDetailGet);
openapi.patch("/", ApplicationDetailPatch);
openapi.patch("/stage", ApplicationStagePatch);
openapi.post("/communications", ApplicationCommunicationsPost);
openapi.post("/notes", ApplicationNotesPost);
openapi.post("/approve", ApplicationApprovePost);

export default openapi;
