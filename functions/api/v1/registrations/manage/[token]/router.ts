import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequest as registrationManageHeadshotRequest_l } from "./headshot";
import { RegistrationsManageTokenHeadshotDelete } from "./headshot";

const app = new Hono();
export const openapi = fromHono(app);

app.put("/headshot", registrationManageHeadshotRequest_l);
openapi.delete("/headshot", RegistrationsManageTokenHeadshotDelete);

export default app;
