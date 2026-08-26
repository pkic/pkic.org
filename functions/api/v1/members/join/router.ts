import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersJoinStartPost } from "./start";
import { MembersJoinVerifyPost } from "./verify";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/start", MembersJoinStartPost);
openapi.post("/verify", MembersJoinVerifyPost);

export default openapi;
