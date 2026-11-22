import {
  eventContentCheckGetRouteSchema,
  eventContentCheckPutRouteSchema,
  eventContentCheckTrialRouteSchema,
} from "../../../../../assets/shared/schemas/content-checks";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  readEventContentCheck,
  saveEventContentCheckAdditions,
} from "../../../../_lib/services/content-checks/settings";
import { runContentCheckTrial } from "../../../../_lib/services/content-checks/trial";
import { requireEventPermission } from "./authorization";

const EventContentCheckGet = openApiRoute(eventContentCheckGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
  return json(await readEventContentCheck(db, event.id, data.params.kind));
});

const EventContentCheckPut = openApiRoute(eventContentCheckPutRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const saved = await saveEventContentCheckAdditions(db, actor, event.id, data.params.kind, data.body);
  return json({ success: true, ...saved });
});

const EventContentCheckTrialPost = openApiRoute(eventContentCheckTrialRouteSchema, async (c: AdminContext, data) => {
  await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json(await runContentCheckTrial(c.env, data.params.kind, data.body));
});

type ContentCheckRouter = Pick<typeof import("./router").openapi, "get" | "post" | "put">;

/** An event's additions to each PKIC-wide check are one nested resource of the event. */
export function registerEventContentCheckRoutes(openapi: ContentCheckRouter): void {
  openapi.get("/content-checks/:kind", EventContentCheckGet);
  openapi.put("/content-checks/:kind", EventContentCheckPut);
  openapi.post("/content-checks/:kind/trials", EventContentCheckTrialPost);
}
