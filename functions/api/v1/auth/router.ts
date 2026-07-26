import { Hono } from "hono";
import { fromHono } from "chanfana";
import passkeys_Router from "./passkeys/router";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/passkeys", passkeys_Router);

export default openapi;
