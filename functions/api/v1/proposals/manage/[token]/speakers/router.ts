import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as ProposalsManageTokenSpeakersRemindPost_l } from "./remind";
import { onRequestPatch as ProposalsManageTokenSpeakerPatch_l } from "./[userId]";
import { onRequest as ProposalsManageTokenSpeakerHeadshot_l } from "./[userId]/headshot";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/remind", ProposalsManageTokenSpeakersRemindPost_l);
app.patch("/:userId", ProposalsManageTokenSpeakerPatch_l);
app.get("/:userId/headshot", ProposalsManageTokenSpeakerHeadshot_l);
app.put("/:userId/headshot", ProposalsManageTokenSpeakerHeadshot_l);
app.delete("/:userId/headshot", ProposalsManageTokenSpeakerHeadshot_l);

export default app;
