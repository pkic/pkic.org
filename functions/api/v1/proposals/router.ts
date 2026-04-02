import { Hono } from "hono";
import { fromHono } from "chanfana";
import manage_Router from "./manage/router";
import speaker_Router from "./speaker/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/manage", manage_Router);
app.route("/speaker", speaker_Router);

export default app;
