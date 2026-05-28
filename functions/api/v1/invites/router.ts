import { Hono } from "hono";
import { fromHono } from "chanfana";
import token_Router from "./[token]/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/:token", token_Router);

export default openapi;
