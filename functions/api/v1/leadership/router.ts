import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ConsortiumChairsPublicGet } from "./consortium-chairs";
import { LeadershipPublicGet } from "./[body]";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/consortium-chairs", ConsortiumChairsPublicGet);
openapi.get("/:body", LeadershipPublicGet);

export default openapi;
