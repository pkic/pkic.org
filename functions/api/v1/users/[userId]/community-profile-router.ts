/**
 * The community-profile routes, mounted OUTSIDE the staff boundary.
 *
 * `users/router.ts` puts a staff D1 session middleware in front of everything
 * under `/:userId`, and that middleware calls `requireAdminFromRequest` before
 * a route's own guard ever runs. A signed-in member reading a peer's profile is
 * not an administrator, so these routes are registered ahead of it — the same
 * way `/:userId/headshots` already is — and carry their own authorization.
 *
 * The record itself is here for the same reason: a member has no `users:read`,
 * yet "My profile" is their own record and they must be able to open it. Its
 * guard answers "is this you, or do you administer users" rather than trusting
 * the boundary it sits in front of.
 *
 * Only reads and the vouch pair live here. Everything administrative about a
 * user record stays behind the staff boundary where it belongs.
 */
import { Hono } from "hono";
import { fromHono } from "chanfana";

import type { RequestDbContext } from "../../../../_lib/db/context";
import {
  MemberAvailabilityGet,
  MemberSkillsGet,
  MemberSkillVouchDelete,
  MemberSkillVouchPost,
  MemberStandingGet,
} from "./member-profile";
import { UserGet } from "./index";
import { UserParticipationGet } from "./participation";
import participationHistoryRouter from "./participation/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/skills", MemberSkillsGet);
openapi.post("/skills/:skillId/vouches", MemberSkillVouchPost);
openapi.delete("/skills/:skillId/vouches", MemberSkillVouchDelete);
openapi.get("/standing", MemberStandingGet);
openapi.get("/availability", MemberAvailabilityGet);
openapi.get("/participation", UserParticipationGet);
openapi.route("/participation", participationHistoryRouter);
// Registered last so the named sub-paths above are matched first.
openapi.get("/", UserGet);

export default openapi;
