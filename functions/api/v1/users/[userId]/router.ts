import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { UserAnonymizePost } from "./anonymize";
import { UserGravatarPost } from "./gravatar";
import { UserHeadshotDelete, UserHeadshotGet, UserHeadshotPut } from "./headshot";
import { UserGet, UserPatch } from "./index";
import { MemberAvailabilityPut } from "./member-profile";
import emailsRouter from "./emails/router";
import participationHistoryRouter from "./participation/router";
import rolesRouter from "./roles-router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/headshot", UserHeadshotGet);
openapi.put("/headshot", UserHeadshotPut);
openapi.delete("/headshot", UserHeadshotDelete);
openapi.post("/gravatar", UserGravatarPost);
openapi.post("/anonymize", UserAnonymizePost);
openapi.route("/participation", participationHistoryRouter);
openapi.put("/availability", MemberAvailabilityPut);
openapi.route("/emails", emailsRouter);
openapi.route("/roles", rolesRouter);
openapi.get("/", UserGet);
openapi.patch("/", UserPatch);

export default openapi;
