import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersJoinVerifyPost } from "./verify";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/verify", MembersJoinVerifyPost);

export default openapi;
