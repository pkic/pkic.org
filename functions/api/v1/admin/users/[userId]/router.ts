import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminUsersUserIdAnonymizePost_l } from "./anonymize";
import { onRequestPost as AdminUsersUserIdGravatarPost_l } from "./gravatar";
import { onRequest as adminUserHeadshotRequest_l } from "./headshot";
import { AdminUsersUserIdHeadshotGet } from "./headshot";
import { AdminUsersUserIdHeadshotDelete } from "./headshot";
import { onRequestGet as AdminUsersUserIdGet_l } from "./index";
import { onRequestPatch as AdminUsersUserIdPatch_l } from "./index";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/anonymize", AdminUsersUserIdAnonymizePost_l);
app.post("/gravatar", AdminUsersUserIdGravatarPost_l);
openapi.get("/headshot", AdminUsersUserIdHeadshotGet);
app.put("/headshot", adminUserHeadshotRequest_l);
openapi.delete("/headshot", AdminUsersUserIdHeadshotDelete);
app.get("/", AdminUsersUserIdGet_l);
app.patch("/", AdminUsersUserIdPatch_l);

export default app;
