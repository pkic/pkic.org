import { Hono } from "hono";
import { fromHono } from "chanfana";
import invitations_Router from "./invitations/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/invitations", invitations_Router);

export default openapi;
