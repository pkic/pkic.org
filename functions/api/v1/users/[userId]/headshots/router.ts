import { Hono } from "hono";
import { fromHono } from "chanfana";
import { UserHeadshotFileGet } from "./[file]";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/:file", UserHeadshotFileGet);

export default openapi;
