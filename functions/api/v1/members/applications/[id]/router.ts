import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersApplicationsStatusGet } from "./status";
import { MembersApplicationsDocumentsPost, MembersApplicationsDocumentsGet } from "./documents";
import { MembersApplicationsConcernsPost } from "./concerns";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/status", MembersApplicationsStatusGet);
openapi.post("/documents", MembersApplicationsDocumentsPost);
openapi.get("/documents", MembersApplicationsDocumentsGet);
openapi.post("/concerns", MembersApplicationsConcernsPost);

export default openapi;
