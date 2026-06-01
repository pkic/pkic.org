import { Hono } from "hono";
import { fromHono } from "chanfana";
import manage_Router from "./manage/router";
import speaker_Router from "./speaker/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/manage", manage_Router);
openapi.route("/speaker", speaker_Router);

export default openapi;
