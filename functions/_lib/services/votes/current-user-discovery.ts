/** Current-user vote discovery, live session, page, and hydration in one serving snapshot. */
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionActingIdentitySelection } from "../../auth/identity-capacities";
import { buildOffsetPageSql, buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import type { VotesListQuery } from "../../../../assets/shared/schemas/votes";
import { buildVisibleVotesForMemberPageQuery, prepareVoteHydration } from "./member-read-model";
import type { VoteRow } from "./shared";

export async function listCurrentUserVotesRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  query: VotesListQuery,
) {
  const auth = await prepareUserSessionRequest(db, request, env);
  const page = buildVisibleVotesForMemberPageQuery(auth.claims.sub, query);
  const selected = buildOffsetPageSql(page);
  const hydration = prepareVoteHydration(
    db,
    {
      sql: `SELECT id FROM (${selected.pageSql})`,
      bindings: [...selected.bindings, query.limit, query.offset],
    },
    auth.claims.sub,
    userSessionActingIdentitySelection(auth.claims.sub, auth.claims.iid),
  );
  const results = await db.batch([...auth.statements, ...buildOffsetPageStatements(db, page), ...hydration.statements]);
  const session = await auth.decode(results.slice(0, auth.statements.length));
  if (!session.member) throw new AppError(403, "AUTH_FORBIDDEN", "Active membership required");
  const { rows, total } = decodeOffsetPageResults<VoteRow>(
    results[auth.statements.length],
    results[auth.statements.length + 1],
  );
  return { votes: hydration.decode(results.slice(auth.statements.length + 2), rows), total };
}
