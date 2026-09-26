import { Hono } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../../_lib/http";
import { EventsEventSlugRegistrationsConfirmEmailGet } from "./confirm-email";
import { EventsEventSlugRegistrationsConfirmEmailPost } from "./confirm-email";
import { EventsEventSlugRegistrationsConfirmInfoGet } from "./confirm-info";
import { EventsEventSlugRegistrationsResendConfirmationPost } from "./resend-confirmation";
import { EventsEventSlugRegistrationsResendManageLinkPost } from "./resend-manage-link";
import { EventRegistrationsListGet } from "./index";
import { EventRegistrationExportGet } from "./exports";
import { EventRegistrationPromotionsCreate } from "./promotions";
import registrationIdRouter from "./[registrationId]/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/confirm-email", EventsEventSlugRegistrationsConfirmEmailGet);
openapi.post("/confirm-email", EventsEventSlugRegistrationsConfirmEmailPost);
openapi.get("/confirm-info", EventsEventSlugRegistrationsConfirmInfoGet);
openapi.post("/resend-confirmation", EventsEventSlugRegistrationsResendConfirmationPost);
openapi.post("/resend-manage-link", EventsEventSlugRegistrationsResendManageLinkPost);
openapi.get("/exports", EventRegistrationExportGet);
openapi.post("/promotions", EventRegistrationPromotionsCreate);
openapi.get("/", EventRegistrationsListGet);
openapi.route("/:registrationId", registrationIdRouter);
app.all("/confirm-email", () => methodNotAllowed(["GET", "POST"]));

export default openapi;
