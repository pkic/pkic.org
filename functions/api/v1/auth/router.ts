import { Hono } from "hono";
import { fromHono } from "chanfana";
import passkeys_Router from "./passkeys/router";
import member_Router from "./member/router";
import sponsorPortal_Router from "./sponsor-portal/router";
import portal_Router from "./portal/router";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/passkeys", passkeys_Router);
openapi.route("/member", member_Router);
openapi.route("/sponsor-portal", sponsorPortal_Router);
openapi.route("/portal", portal_Router);

export default openapi;
