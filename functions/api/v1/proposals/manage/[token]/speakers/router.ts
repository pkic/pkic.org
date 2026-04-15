import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as ProposalsManageTokenSpeakersRemindPost_l } from "./remind";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/remind", ProposalsManageTokenSpeakersRemindPost_l);

export default app;
