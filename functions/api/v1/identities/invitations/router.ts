import { Hono } from "hono";
import { fromHono } from "chanfana";
import { IdentityInvitationAcceptPost } from "./accept";
import { IdentityInvitationPreviewPost } from "./preview";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/preview", IdentityInvitationPreviewPost);
openapi.post("/accept", IdentityInvitationAcceptPost);

export default openapi;
