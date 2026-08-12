import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorshipTierConfigList } from "./index";
import { SponsorshipTierConfigUpdate } from "./[id]";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", SponsorshipTierConfigList);
openapi.patch("/:id", SponsorshipTierConfigUpdate);

export default openapi;
