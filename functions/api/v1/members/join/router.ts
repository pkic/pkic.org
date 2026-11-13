import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersJoinAffiliationsPost } from "./affiliations";
import { MembersJoinVerifyPost } from "./verify";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/verify", MembersJoinVerifyPost);
openapi.post("/affiliations", MembersJoinAffiliationsPost);

export default openapi;
