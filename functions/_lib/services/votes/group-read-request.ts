/** Complete authenticated group vote reads in one D1 binding round trip. */
import type { RawVoteBallotsListQuery } from "../../../../assets/shared/schemas/vote-management";
import { prepareGroupResourceRequest } from "../groups/resource-request";
import { groupResourceContextAuthorizationEvidence } from "../resource-grants/access";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike, Env } from "../../types";
import { AppError } from "../../errors";
import { prepareGroupVoteDetailRow, projectGroupVoteDetail } from "./group-read-model";
import { prepareVoteHydration } from "./member-read-model";
import { prepareBallotAudit } from "./ballot-audit";

export async function readGroupVoteDetailRequest(
  db: DatabaseLike,
  request: Request,
  env: Env,
  groupReference: string,
  voteId: string,
) {
  const actor = await prepareGroupResourceRequest(db, request, env, groupReference);
  const read = prepareGroupVoteDetailRow(db, actor.group, voteId, actor.access);
  const hydration = prepareVoteHydration(
    db,
    { sql: "SELECT id FROM votes WHERE id=?", bindings: [voteId] },
    actor.userId,
    actor.identitySelection,
    actor.group,
  );
  const results = await db.batch([...actor.statements, read.statement, ...hydration.statements]);
  const group = await actor.decode(results.slice(0, actor.statements.length));
  const { row, capabilities } = read.decode(results[actor.statements.length], group.group.id);
  const [hydrated] = hydration.decode(results.slice(actor.statements.length + 1), [row]);
  return projectGroupVoteDetail(row, capabilities, hydrated);
}

export async function readGroupBallotAuditRequest(
  db: DatabaseLike,
  request: Request,
  env: Env,
  groupReference: string,
  voteId: string,
  query: RawVoteBallotsListQuery,
) {
  const actor = await prepareGroupResourceRequest(db, request, env, groupReference);
  const access = groupResourceContextAuthorizationEvidence(actor.group, "vote", voteId, "manage");
  const read = prepareBallotAudit(db, voteId, query);
  const results = await db.batch([
    ...actor.statements,
    db.prepare(`SELECT EXISTS(${access.sql}) AS allowed`).bind(...access.bindings),
    ...read.statements,
  ]);
  const group = await actor.decode(results.slice(0, actor.statements.length));
  if (!group.staff || !group.manager)
    throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  if (batchFirst<{ allowed: number }>(results[actor.statements.length])?.allowed !== 1)
    throw new AppError(403, "VOTE_MANAGEMENT_REQUIRED", "Effective vote management permission is required");
  return read.decode(results.slice(actor.statements.length + 1));
}
