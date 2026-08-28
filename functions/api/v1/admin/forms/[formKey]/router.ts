import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminFormsFormKeyGet } from "./index";
import { AdminFormsFormKeyPatch } from "./index";
import { AdminFormsFormKeyDelete } from "./index";
import { AdminFormsFormKeySubmissionsGet } from "./submissions";
import { AdminFormsFormKeySubmissionStatsGet } from "./submission-stats";
import { AdminFormPlacementCreate, AdminFormPlacementsList, AdminFormPlacementUpdate } from "./placements";
import { requestDb, type RequestDbContext } from "../../../../../_lib/db/context";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { rejectLegacyMembershipApplicationFormRoute } from "../../../../../_lib/services/membership/application-form";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.use("*", async (c, next) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const formKey = c.req.param("formKey");
  if (formKey) rejectLegacyMembershipApplicationFormRoute(formKey);
  await next();
});

openapi.get("/", AdminFormsFormKeyGet);
openapi.patch("/", AdminFormsFormKeyPatch);
openapi.delete("/", AdminFormsFormKeyDelete);
openapi.get("/submissions", AdminFormsFormKeySubmissionsGet);
openapi.get("/submissions/stats", AdminFormsFormKeySubmissionStatsGet);
openapi.get("/placements", AdminFormPlacementsList);
openapi.post("/placements", AdminFormPlacementCreate);
openapi.patch("/placements/:placementId", AdminFormPlacementUpdate);

export default openapi;
