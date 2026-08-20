import { Hono } from "hono";
import { fromHono } from "chanfana";
import { LeadershipPositionsList, LeadershipPositionsCreate } from "./index";
import { LeadershipPositionUpdate, LeadershipPositionDelete } from "./[id]";
import { LeadershipAffiliationsList } from "./affiliations";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", LeadershipPositionsList);
openapi.post("/", LeadershipPositionsCreate);
openapi.get("/users/:userId/affiliations", LeadershipAffiliationsList);
openapi.patch("/:id", LeadershipPositionUpdate);
openapi.delete("/:id", LeadershipPositionDelete);

export default openapi;
