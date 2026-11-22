import {
  ownUnfinishedRegistrationGetRouteSchema,
  ownUnfinishedRegistrationStopRouteSchema,
  unfinishedRegistrationNotesRouteSchema,
  unfinishedRegistrationStartRouteSchema,
  unfinishedRegistrationSummaryRouteSchema,
} from "../../../../../assets/shared/schemas/unfinished-registrations";
import { getUserSessionToken, requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { AppError } from "../../../../_lib/errors";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../_lib/services/events";
import { readAudienceEventBySlug } from "../../../../_lib/services/events/audience-event";
import {
  listUnfinishedRegistrationNotes,
  readOwnUnfinishedRegistration,
  readUnfinishedRegistrationSummary,
  startUnfinishedRegistration,
  stopUnfinishedRegistration,
} from "../../../../_lib/services/registrations/unfinished";
import { requireEventPermission } from "./authorization";

const UnfinishedRegistrationSummaryGet = openApiRoute(
  unfinishedRegistrationSummaryRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
    return json(await readUnfinishedRegistrationSummary(db, event));
  },
);

const UnfinishedRegistrationNotesGet = openApiRoute(
  unfinishedRegistrationNotesRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
    return json(await listUnfinishedRegistrationNotes(db, event, data.query));
  },
);

const UnfinishedRegistrationStartPost = openApiRoute(
  unfinishedRegistrationStartRouteSchema,
  async (c: AdminContext, data) => {
    if (!getUserSessionToken(c.req.raw)) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
    const db = requestDb(c);
    const { event, identity } = await readAudienceEventBySlug(db, c.req.raw, c.env, data.params.eventSlug);
    if (!identity) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
    await startUnfinishedRegistration(db, event, identity.userId);
    return json({ success: true });
  },
);

const OwnUnfinishedRegistrationGet = openApiRoute(
  ownUnfinishedRegistrationGetRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    if (!getUserSessionToken(c.req.raw)) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
    const db = requestDb(c);
    const { event, identity } = await readAudienceEventBySlug(db, c.req.raw, c.env, data.params.eventSlug);
    if (!identity) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
    return json(await readOwnUnfinishedRegistration(db, event, identity.userId));
  },
);

const OwnUnfinishedRegistrationStopPost = openApiRoute(
  ownUnfinishedRegistrationStopRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
    await stopUnfinishedRegistration(db, await getEventBySlug(db, data.params.eventSlug), identity.userId, data.body);
    return json({ success: true });
  },
);

type UnfinishedRegistrationRouter = Pick<typeof import("./router").openapi, "get" | "post">;

/** Unfinished registrations are a collection under the event's registrations; `current` is the caller's own. */
export function registerUnfinishedRegistrationRoutes(openapi: UnfinishedRegistrationRouter): void {
  openapi.post("/registrations/unfinished", UnfinishedRegistrationStartPost);
  openapi.get("/registrations/unfinished/summary", UnfinishedRegistrationSummaryGet);
  openapi.get("/registrations/unfinished/notes", UnfinishedRegistrationNotesGet);
  openapi.get("/registrations/unfinished/current", OwnUnfinishedRegistrationGet);
  openapi.post("/registrations/unfinished/current/stop", OwnUnfinishedRegistrationStopPost);
}
