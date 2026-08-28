import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { createRequestScopedD1SessionMiddleware } from "../../../_lib/db/request-session-middleware";
import { UsersList } from "./index";
import userIdRouter from "./[userId]/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", createRequestScopedD1SessionMiddleware());

openapi.get("/", UsersList);
openapi.route("/:userId", userIdRouter);

export default openapi;
