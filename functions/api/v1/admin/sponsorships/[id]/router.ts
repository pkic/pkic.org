import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorshipGet, SponsorshipUpdate } from "./index";
import { SponsorshipStageUpdate } from "./stage";
import { SponsorshipEventsList } from "./events";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", SponsorshipGet);
openapi.patch("/", SponsorshipUpdate);
openapi.patch("/stage", SponsorshipStageUpdate);
openapi.get("/events", SponsorshipEventsList);

export default openapi;
