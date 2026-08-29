import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ConsortiumChairsPublicGet } from "./consortium-chairs";
import { LeadershipPublicGet } from "./[body]";
import positions_Router from "./positions/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/consortium-chairs", ConsortiumChairsPublicGet);
openapi.route("/positions", positions_Router);
openapi.get("/:body", LeadershipPublicGet);

export default openapi;
