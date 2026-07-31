import { Hono } from "hono";
import { fromHono } from "chanfana";
import { LeadershipPositionsList, LeadershipPositionsCreate } from "./index";
import { LeadershipPositionUpdate, LeadershipPositionDelete } from "./[id]";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", LeadershipPositionsList);
openapi.post("/", LeadershipPositionsCreate);
openapi.patch("/:id", LeadershipPositionUpdate);
openapi.delete("/:id", LeadershipPositionDelete);

export default openapi;
