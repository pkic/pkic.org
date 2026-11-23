import {
  eventClassifierGetRouteSchema,
  eventClassifierPutRouteSchema,
  eventClassifierTrialRouteSchema,
} from "../../../../../assets/shared/schemas/classifiers";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { readEventClassifier, saveEventClassifierAdditions } from "../../../../_lib/services/classifiers/settings";
import { runClassifierTrial } from "../../../../_lib/services/classifiers/trial";
import { requireEventPermission } from "./authorization";

const EventClassifierGet = openApiRoute(eventClassifierGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
  return json(await readEventClassifier(db, event.id, data.params.kind));
});

const EventClassifierPut = openApiRoute(eventClassifierPutRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const saved = await saveEventClassifierAdditions(db, actor, event.id, data.params.kind, data.body);
  return json({ success: true, ...saved });
});

const EventClassifierTrialPost = openApiRoute(eventClassifierTrialRouteSchema, async (c: AdminContext, data) => {
  const { actor } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json(await runClassifierTrial(c.env, actor.id, data.params.kind, data.body));
});

type ClassifierRouter = Pick<typeof import("./router").openapi, "get" | "post" | "put">;

/** An event's additions to each PKIC-wide check are one nested resource of the event. */
export function registerEventClassifierRoutes(openapi: ClassifierRouter): void {
  openapi.get("/classifiers/:kind", EventClassifierGet);
  openapi.put("/classifiers/:kind", EventClassifierPut);
  openapi.post("/classifiers/:kind/trials", EventClassifierTrialPost);
}
