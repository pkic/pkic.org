import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as InternalEmailResetFailedPost_l } from "./reset-failed";
import { InternalEmailRetryPost } from "./retry";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/reset-failed", InternalEmailResetFailedPost_l);
openapi.post("/retry", InternalEmailRetryPost);

export default openapi;
