import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersApplicationsStatusGet } from "./status";
import { MembersApplicationsDocumentsPost, MembersApplicationsDocumentsGet } from "./documents";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/status", MembersApplicationsStatusGet);
openapi.post("/documents", MembersApplicationsDocumentsPost);
openapi.get("/documents", MembersApplicationsDocumentsGet);

export default openapi;
