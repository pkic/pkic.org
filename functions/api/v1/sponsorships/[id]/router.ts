import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorshipGet, SponsorshipUpdate } from "./index";
import { SponsorshipStageUpdate } from "./stage";
import { SponsorshipEventsList } from "./events";
import { SponsorshipLogoPut, SponsorshipLogoDelete } from "./logo";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", SponsorshipGet);
openapi.patch("/", SponsorshipUpdate);
openapi.patch("/stage", SponsorshipStageUpdate);
openapi.get("/events", SponsorshipEventsList);
openapi.put("/logo", SponsorshipLogoPut);
openapi.delete("/logo", SponsorshipLogoDelete);

export default openapi;
