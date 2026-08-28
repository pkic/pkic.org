import { Hono } from "hono";
import { fromHono } from "chanfana";
import passkeys_Router from "./passkeys/router";
import sponsorPortal_Router from "./sponsor-portal/router";
import type { RequestDbContext } from "../../../_lib/db/context";
import { UserAuthRequestLink } from "./request-link";
import { UserAuthVerifyLink } from "./verify-link";
import { UserAuthSession } from "./session";
import { UserAuthLogout } from "./logout";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/passkeys", passkeys_Router);
openapi.route("/sponsor-portal", sponsorPortal_Router);
openapi.post("/request-link", UserAuthRequestLink);
openapi.post("/verify-link", UserAuthVerifyLink);
openapi.get("/session", UserAuthSession);
openapi.post("/logout", UserAuthLogout);

export default openapi;
