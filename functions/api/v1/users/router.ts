import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { createRequestScopedD1SessionMiddleware } from "../../../_lib/db/request-session-middleware";
import { UsersList } from "./index";
import currentUserRouter from "./current/router";
import publicUserHeadshotsRouter from "./[userId]/headshots/router";
import communityProfileRouter from "./[userId]/community-profile-router";
import userIdRouter from "./[userId]/router";

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
app.use("*", createRequestScopedD1SessionMiddleware());
openapi.get("/", UsersList);
openapi.route("/:userId", userIdRouter);

export default openapi;
