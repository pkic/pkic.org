import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as HeadshotsUserIdFileGet_l } from "./[file]";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/:file", HeadshotsUserIdFileGet_l);

export default openapi;
