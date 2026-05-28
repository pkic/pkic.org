import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as ProposalsManageTokenSpeakersPost_l } from "./speakers";
import speakers_Router from "./speakers/router";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/speakers", ProposalsManageTokenSpeakersPost_l);
openapi.route("/speakers", speakers_Router);

export default openapi;
