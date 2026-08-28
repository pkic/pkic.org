import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import accessControl_Router from "./access-control/router";
import { EmailTemplatesList } from "./email-templates";
import emailTemplates_Router from "./email-templates/router";
import leadershipPositions_Router from "./leadership-positions/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/access-control", accessControl_Router);
openapi.get("/email-templates", EmailTemplatesList);
openapi.route("/email-templates", emailTemplates_Router);
openapi.route("/leadership-positions", leadershipPositions_Router);

export default openapi;
