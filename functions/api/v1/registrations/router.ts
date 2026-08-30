import { Hono } from "hono";
import { fromHono } from "chanfana";
import manage_Router from "./manage/router";
import { onRequestGet as RegistrationReferralBadgeGet } from "./referrals/[code]/badge";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/referrals/:code/badge", RegistrationReferralBadgeGet);
openapi.route("/manage", manage_Router);

export default openapi;
