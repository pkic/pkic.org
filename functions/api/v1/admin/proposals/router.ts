import { Hono } from "hono";
import { fromHono } from "chanfana";
import proposalId_Router from "./[proposalId]/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/:proposalId", proposalId_Router);

export default app;
