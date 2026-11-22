import { prepareOptionalRequestViewer, type PreparedRequestViewerRead } from "../../auth/optional-request-viewer";
import type { AuthenticatedIdentity } from "../../auth/user-session";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { EVENT_COLUMNS, type EventRecord } from "../events";
import { buildEventAudiencePredicate } from "./visibility";

/** The canonical event row selection for a viewer, shared with form configuration reads. */
export function prepareAudienceEventBySlug(db: DatabaseLike, slug: string, auth: PreparedRequestViewerRead | null) {
  const audience = buildEventAudiencePredicate("events", {
    userId: auth?.userId ?? null,
    ...(auth ? { admin: auth.permissionActor } : {}),
  });
  return db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE slug = ? AND ${audience.sql}`)
    .bind(slug, ...audience.bindings);
}

/** Resolve an event only when the request's viewer belongs to its audience. */
export async function readAudienceEventBySlug(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET" | "ADMIN_API_KEY">,
  slug: string,
) {
  const auth = await prepareOptionalRequestViewer(db, request, env);
  const authentication = auth?.statements ?? [];
  const loaded = await db.batch([...authentication, prepareAudienceEventBySlug(db, slug, auth)]);
  const viewer = auth ? await auth.decode(loaded.slice(0, authentication.length)) : null;
  const event = batchFirst<EventRecord>(loaded[authentication.length]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found or not visible to this caller");
  const session = viewer?.session;
  const identity: AuthenticatedIdentity | null = session
    ? {
        userId: session.identity.id,
        email: session.identity.email,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
      }
    : null;
  return { event, identity };
}
