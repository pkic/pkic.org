import { Hono } from "hono";
import { fromHono } from "chanfana";
import token_Router from "./[token]/router";
import { InvitesResendLinkPost } from "./resend-link";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/resend-link", InvitesResendLinkPost);
openapi.route("/:token", token_Router);

export default openapi;
