import { Hono } from "hono";
import { fromHono } from "chanfana";
import {
  contentCheckSettingsListResponseSchema,
  contentCheckSettingsPutRouteSchema,
  contentChecksListRouteSchema,
  contentCheckTrialRouteSchema,
} from "../../../../assets/shared/schemas/content-checks";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext, RequestDbContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listContentCheckSettings, saveContentCheckSettings } from "../../../_lib/services/content-checks/settings";
import { runContentCheckTrial } from "../../../_lib/services/content-checks/trial";

const ContentChecksList = openApiRoute(contentChecksListRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "events:manage");
  return json(contentCheckSettingsListResponseSchema.parse({ checks: await listContentCheckSettings(db) }));
});

const ContentCheckSettingsPut = openApiRoute(contentCheckSettingsPutRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "events:manage");
  return json({ success: true, ...(await saveContentCheckSettings(db, staff, data.params.kind, data.body)) });
});

const ContentCheckTrialPost = openApiRoute(contentCheckTrialRouteSchema, async (c: AdminContext, data) => {
  const { staff } = await requireStaffPermission(c, "events:manage");
  return json(await runContentCheckTrial(c.env, staff.id, data.params.kind, data.body));
});

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", ContentChecksList);
openapi.put("/:kind", ContentCheckSettingsPut);
openapi.post("/:kind/trials", ContentCheckTrialPost);
export default openapi;
