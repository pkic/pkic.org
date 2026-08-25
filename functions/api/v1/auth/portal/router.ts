import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { PortalAuthLogout } from "./logout";
import { PortalAuthRequestLink } from "./request-link";
import { PortalAuthSession } from "./session";
import { PortalAuthVerifyLink } from "./verify-link";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/request-link", PortalAuthRequestLink);
openapi.post("/verify-link", PortalAuthVerifyLink);
openapi.get("/session", PortalAuthSession);
openapi.post("/logout", PortalAuthLogout);

export default openapi;
