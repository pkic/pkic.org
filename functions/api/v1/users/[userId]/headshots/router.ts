import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as UserHeadshotFileGet } from "./[file]";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/:file", UserHeadshotFileGet);

export default openapi;
