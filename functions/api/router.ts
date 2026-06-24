import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../_lib/http";
import v1_Router from "./v1/router";

const app = new Hono();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.route("/v1", v1_Router);

export default openapi;
