import { Hono } from "hono";
import { fromHono } from "chanfana";
import {
  AnalyticsSummaryGet,
  DonationAnalyticsGet,
  MembershipAnalyticsGet,
  OrganizationAnalyticsGet,
  RegistrationAnalyticsGet,
  UserAnalyticsGet,
} from "./index";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/summary", AnalyticsSummaryGet);
openapi.get("/registrations", RegistrationAnalyticsGet);
openapi.get("/donations", DonationAnalyticsGet);
openapi.get("/members", MembershipAnalyticsGet);
openapi.get("/organizations", OrganizationAnalyticsGet);
openapi.get("/users", UserAnalyticsGet);

export default openapi;
