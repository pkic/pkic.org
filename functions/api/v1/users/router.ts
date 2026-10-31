import { UserIdentityDelete } from "./[userId]/identity-removal";
import { RepresentationEmailGet, RepresentationEmailPut } from "./[userId]/identity-email";
import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { createRequestScopedD1SessionMiddleware } from "../../../_lib/db/request-session-middleware";
import { UsersList, UserCreate } from "./index";
import currentUserRouter from "./current/router";
import publicUserHeadshotsRouter from "./[userId]/headshots/router";
import communityProfileRouter from "./[userId]/community-profile-router";
import userIdRouter from "./[userId]/router";
import { UserIdentityCorrectionPost } from "./[userId]/identity-corrections";
import { UserAuditLogGet } from "./[userId]/audit-log";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

// Current-user routes authenticate the shared human session and may be used by
// a member without staff capacity. Register them before the staff-only D1
// session boundary used by collection and target-user management routes.
openapi.route("/current", currentUserRouter);
openapi.route("/:userId/headshots", publicUserHeadshotsRouter);
// The community profile is readable by any signed-in member, so it is
// registered before the staff-only D1 session boundary below and carries its
// own authorization.
openapi.route("/:userId", communityProfileRouter);
// This read composes its live staff authorization with the scoped audit page.
openapi.get("/:userId/audit-log", UserAuditLogGet);
openapi.post("/:userId/identities/:identityId/corrections", UserIdentityCorrectionPost);
openapi.delete("/:userId/identities/:identityId", UserIdentityDelete);
openapi.get("/:userId/identities/:identityId/email", RepresentationEmailGet);
openapi.put("/:userId/identities/:identityId/email", RepresentationEmailPut);
// The list also composes live authority with its bounded page and count.
openapi.get("/", UsersList);
app.use("*", createRequestScopedD1SessionMiddleware());
openapi.post("/", UserCreate);
openapi.route("/:userId", userIdRouter);

export default openapi;
