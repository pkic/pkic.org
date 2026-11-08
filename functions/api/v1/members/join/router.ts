import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersJoinStartPost } from "./start";
import { MembersJoinAffiliationsPost } from "./affiliations";
import { MembersJoinVerifyPost } from "./verify";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/start", MembersJoinStartPost);
openapi.post("/verify", MembersJoinVerifyPost);
openapi.post("/affiliations", MembersJoinAffiliationsPost);

export default openapi;
