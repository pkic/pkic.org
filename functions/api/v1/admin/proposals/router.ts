import { Hono } from "hono";
import { fromHono } from "chanfana";
import proposalId_Router from "./[proposalId]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/:proposalId", proposalId_Router);

export default openapi;
