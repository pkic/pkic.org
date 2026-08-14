import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorshipsList, SponsorshipsCreate } from "./index";
import { SponsorshipCompaniesList } from "./companies/index";
import id_Router from "./[id]/router";
import tierConfig_Router from "./tier-config/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", SponsorshipsList);
openapi.post("/", SponsorshipsCreate);
// Registered before the /:id catch-all so "tier-config"/"companies" aren't swallowed as an :id value.
openapi.get("/companies", SponsorshipCompaniesList);
openapi.route("/tier-config", tierConfig_Router);
openapi.route("/:id", id_Router);

export default openapi;
