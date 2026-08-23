import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminUsersUserIdAnonymizePost } from "./anonymize";
import { onRequestPost as AdminUsersUserIdGravatarPost_l } from "./gravatar";
import { AdminUsersUserIdHeadshotGet } from "./headshot";
import { AdminUsersUserIdHeadshotPut } from "./headshot";
import { AdminUsersUserIdHeadshotDelete } from "./headshot";
import { AdminUsersUserIdGet } from "./index";
import { onRequestPatch as AdminUsersUserIdPatch_l } from "./index";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { adminUserUpdateRouteSchema } from "../../../../../../assets/shared/schemas/admin-users";
import { adminUserGravatarImportRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { UserMembershipGrant } from "./membership";
import roles_Router from "./roles/router";
import emails_Router from "./emails/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/anonymize", AdminUsersUserIdAnonymizePost);
openapi.post("/gravatar", openApiRoute(adminUserGravatarImportRouteSchema, AdminUsersUserIdGravatarPost_l));
openapi.get("/headshot", AdminUsersUserIdHeadshotGet);
openapi.put("/headshot", AdminUsersUserIdHeadshotPut);
openapi.delete("/headshot", AdminUsersUserIdHeadshotDelete);
openapi.get("/", AdminUsersUserIdGet);
openapi.patch("/", openApiRoute(adminUserUpdateRouteSchema, AdminUsersUserIdPatch_l));
openapi.post("/membership", UserMembershipGrant);
openapi.route("/roles", roles_Router);
openapi.route("/emails", emails_Router);

export default openapi;
