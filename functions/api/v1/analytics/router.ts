import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AnalyticsSummaryGet, DonationAnalyticsGet, RegistrationAnalyticsGet } from "./index";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/summary", AnalyticsSummaryGet);
openapi.get("/registrations", RegistrationAnalyticsGet);
openapi.get("/donations", DonationAnalyticsGet);

export default openapi;
