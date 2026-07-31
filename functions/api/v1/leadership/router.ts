import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ForumChairsPublicGet } from "./forum-chairs";
import { LeadershipPublicGet } from "./[body]";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/forum-chairs", ForumChairsPublicGet);
openapi.get("/:body", LeadershipPublicGet);

export default openapi;
