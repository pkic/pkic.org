import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { prepareEventAudienceDetail } from "../events/catalog";
import { prepareEventBySlug } from "../events";
import type { EventReadSelection } from "../events/selection";

interface ParticipantRead<T> {
  statements: Parameters<DatabaseLike["batch"]>[0];
  decode(loaded: D1StatementResult[]): T | Promise<T>;
}

/** Compose existing live session and event policy with a participant resource's prepared read. */
export async function readParticipantEvent<T>(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  visibility: "audience" | "existing",
  prepare: (userId: string, event: EventReadSelection, sessionId: string) => ParticipantRead<T>,
): Promise<T> {
  const auth = await prepareUserSessionRequest(db, request, env);
  const read = prepare(auth.claims.sub, { slug: eventSlug }, auth.claims.sid);
  const event =
    visibility === "audience"
      ? prepareEventAudienceDetail(db, { userId: auth.claims.sub }, eventSlug)
      : prepareEventBySlug(db, eventSlug);
  const loaded = await db.batch([...auth.statements, event, ...read.statements]);
  // JWT claims only plan queries. Release no resource data until the canonical live session passes.
  await auth.decode(loaded.slice(0, auth.statements.length));
  if (!batchFirst(loaded[auth.statements.length]))
    throw new AppError(404, "EVENT_NOT_FOUND", "Event not found or not visible to this caller");
  return read.decode(loaded.slice(auth.statements.length + 1));
}
