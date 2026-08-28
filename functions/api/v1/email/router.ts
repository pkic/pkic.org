import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EmailOutboxGet } from "./outbox";
import { EmailOutboxProcessPost } from "./outbox/process";
import { EmailOutboxResetFailedPost } from "./outbox/reset-failed";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/outbox", EmailOutboxGet);
openapi.post("/outbox/process", EmailOutboxProcessPost);
openapi.post("/outbox/reset-failed", EmailOutboxResetFailedPost);

export default openapi;
