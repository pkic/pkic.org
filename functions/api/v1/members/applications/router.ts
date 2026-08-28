import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersApplicationsPost } from "./index";
import { MembersApplicationsFormGet } from "./form";
import { MembersApplicationsFormDefinitionGet, MembersApplicationsFormDefinitionPatch } from "./form-definition";
import applicationId_Router from "./[id]/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/form", MembersApplicationsFormGet);
openapi.get("/form/definition", MembersApplicationsFormDefinitionGet);
openapi.patch("/form/definition", MembersApplicationsFormDefinitionPatch);
openapi.post("/", MembersApplicationsPost);
openapi.route("/:id", applicationId_Router);

export default openapi;
