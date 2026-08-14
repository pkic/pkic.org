import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EventsEventSlugProposalsResendSpeakerManageLinkPost } from "./resend-speaker-manage-link";
import { EventsEventSlugProposalsResendManageLinkPost } from "./resend-manage-link";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/resend-speaker-manage-link", EventsEventSlugProposalsResendSpeakerManageLinkPost);
openapi.post("/resend-manage-link", EventsEventSlugProposalsResendManageLinkPost);

export default openapi;
