import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { readStaffProjection } from "../../auth/staff-projection";
import type { IdentitiesListQuery } from "../../../../assets/shared/schemas/identity";
import type { DatabaseLike, Env } from "../../types";
import { prepareIdentitiesList } from "./read-model";

export async function listOwnIdentitiesRequest(
  db: DatabaseLike,
  request: Request,
  env: Env,
  query: IdentitiesListQuery,
) {
  const actor = await prepareUserSessionRequest(db, request, env);
  const read = prepareIdentitiesList(db, query, { userId: actor.claims.sub });
  const loaded = await db.batch([...actor.statements, ...read.statements]);
  await actor.decode(loaded.slice(0, actor.statements.length));
  return read.decode(loaded.slice(actor.statements.length));
}

export function listIdentityRecordsRequest(db: DatabaseLike, request: Request, env: Env, query: IdentitiesListQuery) {
  return readStaffProjection(db, request, env, "membership:read", prepareIdentitiesList(db, query, {}));
}
