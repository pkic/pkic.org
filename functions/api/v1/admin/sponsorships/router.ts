import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorshipsList, SponsorshipsCreate } from "./index";
import id_Router from "./[id]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", SponsorshipsList);
openapi.post("/", SponsorshipsCreate);
openapi.route("/:id", id_Router);

export default openapi;
