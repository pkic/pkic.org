import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EventsEventSlugProposalsResendSpeakerManageLinkPost } from "./resend-speaker-manage-link";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/resend-speaker-manage-link", EventsEventSlugProposalsResendSpeakerManageLinkPost);

export default openapi;
