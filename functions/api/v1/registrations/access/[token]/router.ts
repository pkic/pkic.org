import { Hono } from "hono";
import { fromHono } from "chanfana";
import { RegistrationsManageTokenHeadshotDelete, RegistrationsManageTokenHeadshotPut } from "./headshot";

const app = new Hono();
export const openapi = fromHono(app);

openapi.put("/headshot", RegistrationsManageTokenHeadshotPut);
openapi.delete("/headshot", RegistrationsManageTokenHeadshotDelete);

export default openapi;
