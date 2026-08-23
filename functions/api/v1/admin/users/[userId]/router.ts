import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminUsersUserIdAnonymizePost } from "./anonymize";
import { AdminUsersUserIdGravatarPost } from "./gravatar";
import { AdminUsersUserIdHeadshotGet } from "./headshot";
import { AdminUsersUserIdHeadshotPut } from "./headshot";
import { AdminUsersUserIdHeadshotDelete } from "./headshot";
import { AdminUsersUserIdGet } from "./index";
import { AdminUsersUserIdPatch } from "./index";
import { UserMembershipGrant } from "./membership";
import roles_Router from "./roles/router";
import emails_Router from "./emails/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/anonymize", AdminUsersUserIdAnonymizePost);
openapi.post("/gravatar", AdminUsersUserIdGravatarPost);
openapi.get("/headshot", AdminUsersUserIdHeadshotGet);
openapi.put("/headshot", AdminUsersUserIdHeadshotPut);
openapi.delete("/headshot", AdminUsersUserIdHeadshotDelete);
openapi.get("/", AdminUsersUserIdGet);
openapi.patch("/", AdminUsersUserIdPatch);
openapi.post("/membership", UserMembershipGrant);
openapi.route("/roles", roles_Router);
openapi.route("/emails", emails_Router);

export default openapi;
