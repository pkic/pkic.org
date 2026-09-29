/**
 * The person's participation history: four natural sub-collections of the
 * participation resource, each paged on its own. The summary itself stays at
 * the collection root, registered by the parent router.
 */
import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import { UserParticipationDocumentsGet } from "./documents";
import { UserParticipationEventsGet } from "./events";
import { UserParticipationMeetingsGet } from "./meetings";
import { UserParticipationVotesGet } from "./votes";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/events", UserParticipationEventsGet);
openapi.get("/meetings", UserParticipationMeetingsGet);
openapi.get("/documents", UserParticipationDocumentsGet);
openapi.get("/votes", UserParticipationVotesGet);

export default openapi;
