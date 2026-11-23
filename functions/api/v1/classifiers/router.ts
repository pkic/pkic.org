import { Hono } from "hono";
import { fromHono } from "chanfana";
import {
  classifierSettingsListResponseSchema,
  classifierSettingsPutRouteSchema,
  classifierSharedSettingsPutRouteSchema,
  classifiersListRouteSchema,
  classifierTrialRouteSchema,
} from "../../../../assets/shared/schemas/classifiers";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext, RequestDbContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  listClassifierSettings,
  saveClassifierSettings,
  saveClassifierSharedSettings,
} from "../../../_lib/services/classifiers/settings";
import { runClassifierTrial } from "../../../_lib/services/classifiers/trial";

const ClassifiersList = openApiRoute(classifiersListRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "events:manage");
  return json(classifierSettingsListResponseSchema.parse(await listClassifierSettings(db)));
});

const ClassifierSharedSettingsPut = openApiRoute(
  classifierSharedSettingsPutRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "events:manage");
    return json({ success: true, ...(await saveClassifierSharedSettings(db, staff, data.body)) });
  },
);

const ClassifierSettingsPut = openApiRoute(classifierSettingsPutRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "events:manage");
  return json({ success: true, ...(await saveClassifierSettings(db, staff, data.params.kind, data.body)) });
});

const ClassifierTrialPost = openApiRoute(classifierTrialRouteSchema, async (c: AdminContext, data) => {
  const { staff } = await requireStaffPermission(c, "events:manage");
  return json(await runClassifierTrial(c.env, staff.id, data.params.kind, data.body));
});

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", ClassifiersList);
// All content before the kinds, so `all` is never read as a kind.
openapi.put("/all", ClassifierSharedSettingsPut);
openapi.put("/:kind", ClassifierSettingsPut);
openapi.post("/:kind/trials", ClassifierTrialPost);
export default openapi;
