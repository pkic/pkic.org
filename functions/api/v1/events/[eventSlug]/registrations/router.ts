import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EventsEventSlugRegistrationsConfirmEmailGet } from "./confirm-email";
import { EventsEventSlugRegistrationsConfirmEmailPost } from "./confirm-email";
import { onRequestGet as EventsEventSlugRegistrationsConfirmInfoGet_l } from "./confirm-info";
import { EventsEventSlugRegistrationsResendConfirmationPost } from "./resend-confirmation";
import { EventsEventSlugRegistrationsResendManageLinkPost } from "./resend-manage-link";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/confirm-email", EventsEventSlugRegistrationsConfirmEmailGet);
openapi.post("/confirm-email", EventsEventSlugRegistrationsConfirmEmailPost);
app.get("/confirm-info", EventsEventSlugRegistrationsConfirmInfoGet_l);
openapi.post("/resend-confirmation", EventsEventSlugRegistrationsResendConfirmationPost);
openapi.post("/resend-manage-link", EventsEventSlugRegistrationsResendManageLinkPost);

export default openapi;
