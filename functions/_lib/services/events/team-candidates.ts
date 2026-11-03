import type { EventTeamCandidateQuery } from "../../../../assets/shared/schemas/event-team";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import type { DatabaseLike, Env } from "../../types";
import { buildUserCatalogPageQuery, serializeUserCatalogPage, type UserCatalogRow } from "../user-catalog";
import { readEventAdminResource } from "./authorized-context";

/** Authorize the event and load its bounded person picker in one request batch. */
export function listEventTeamRoleCandidates(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  query: EventTeamCandidateQuery,
) {
  return readEventAdminResource(db, request, env, eventSlug, "events:manage", () => ({
    statements: buildOffsetPageStatements(db, buildUserCatalogPageQuery(query, undefined, undefined, "exactEmail")),
    decode(results) {
      const { rows, total } = decodeOffsetPageResults<UserCatalogRow>(results[0], results[1]);
      return serializeUserCatalogPage(query, rows, total);
    },
  }));
}
