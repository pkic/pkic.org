import { Hono } from "hono";
import { fromHono } from "chanfana";
import access_Router from "./access/router";
import { onRequestGet as RegistrationReferralBadgeGet } from "./referrals/[code]/badge";
import { RegistrationParticipantGet, RegistrationParticipantPatch } from "./[registrationId]";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/referrals/:code/badge", RegistrationReferralBadgeGet);
openapi.route("/access", access_Router);
openapi.get("/:registrationId", RegistrationParticipantGet);
openapi.patch("/:registrationId", RegistrationParticipantPatch);

export default openapi;
