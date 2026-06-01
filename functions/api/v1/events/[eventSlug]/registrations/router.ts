import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EventsEventSlugRegistrationsConfirmEmailGet } from "./confirm-email";
import { EventsEventSlugRegistrationsConfirmEmailPost } from "./confirm-email";
import { onRequestGet as EventsEventSlugRegistrationsConfirmInfoGet_l } from "./confirm-info";
import { EventsEventSlugRegistrationsResendConfirmationPost } from "./resend-confirmation";
import { onRequestPost as EventsEventSlugRegistrationsResendManageLinkPost_l } from "./resend-manage-link";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/confirm-email", EventsEventSlugRegistrationsConfirmEmailGet);
openapi.post("/confirm-email", EventsEventSlugRegistrationsConfirmEmailPost);
app.get("/confirm-info", EventsEventSlugRegistrationsConfirmInfoGet_l);
openapi.post("/resend-confirmation", EventsEventSlugRegistrationsResendConfirmationPost);
app.post("/resend-manage-link", EventsEventSlugRegistrationsResendManageLinkPost_l);

export default openapi;
