import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorshipInquiriesPost } from "./inquiries";
import checkout_Router from "./checkout/router";
import { SponsorshipTiersGet } from "./tiers";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/inquiries", SponsorshipInquiriesPost);
openapi.get("/tiers", SponsorshipTiersGet);
openapi.route("/checkout", checkout_Router);

export default openapi;
