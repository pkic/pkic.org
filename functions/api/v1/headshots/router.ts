import { Hono } from "hono";
import { fromHono } from "chanfana";
import userId_Router from "./[userId]/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/:userId", userId_Router);

export default openapi;
