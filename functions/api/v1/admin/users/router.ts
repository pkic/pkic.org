import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPatch as AdminUsersUserIdPatch_l } from "./[userId]";
import userId_Router from "./[userId]/router";

const app = new Hono();
export const openapi = fromHono(app);

app.patch("/:userId", AdminUsersUserIdPatch_l);
app.route("/:userId", userId_Router);

export default app;
