import {
  preparePermissionsAuthorizationGuard,
  requireAnyPermission,
  requirePermission,
  type Permission,
} from "../auth/permissions";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { buildOffsetPageStatements, decodeOffsetPageResults, type OffsetPageQuery } from "../db/pagination";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";

/**
 * The proposal program is owned by exactly one group, but program
 * committee authority is event-scoped. This deliberately does not reuse the
 * generic event-resource grant evaluator: sharing an event for viewing,
 * registration, or attendance must not disclose program submissions.
 */
export interface GroupEventProposalContext {
  groupId: string;
  eventId: string;
  proposalId?: string;
}

interface GroupEventProposalRow {
  group_id: string;
  event_id: string;
}

function exactContextSql(withProposal: boolean): string {
  return `SELECT group_row.id AS group_id, event_row.id AS event_id
            FROM groups group_row
            JOIN events event_row ON event_row.owner_group_id = group_row.id
           WHERE (group_row.id = ? OR group_row.slug = ?)
             AND group_row.active = 1
             AND event_row.id = ?
             ${withProposal ? "AND EXISTS (SELECT 1 FROM session_proposals proposal WHERE proposal.id = ? AND proposal.event_id = event_row.id AND proposal.deleted_at IS NULL)" : ""}
           LIMIT 1`;
}

/** Resolves only an owning group/event/proposal tuple and one event permission. */
export async function requireGroupEventProposalContext(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  permission: Permission | readonly Permission[],
  proposalId?: string,
): Promise<GroupEventProposalContext> {
  const row = await first<GroupEventProposalRow>(
    db,
    exactContextSql(proposalId !== undefined),
    proposalId === undefined
      ? [groupIdOrSlug, groupIdOrSlug, eventId]
      : [groupIdOrSlug, groupIdOrSlug, eventId, proposalId],
  );
  if (!row) {
    throw new AppError(
      404,
      "GROUP_EVENT_PROPOSAL_CONTEXT_NOT_FOUND",
      "The proposal program is not available through this group and event",
    );
  }
  if (typeof permission === "string") {
    requirePermission(actor, permission, { type: "event", id: row.event_id });
  } else {
    requireAnyPermission(actor, permission, { type: "event", id: row.event_id });
  }
  return { groupId: row.group_id, eventId: row.event_id, ...(proposalId ? { proposalId } : {}) };
}

/**
 * Rechecks the immutable path tuple in the same D1 batch as a proposal write.
 * Permission-specific guards remain in the proposal use case, so canonical
 * proposal commands and group event workflows share the same domain transition.
 */
export function prepareGroupEventProposalContextGuard(
  db: DatabaseLike,
  context: GroupEventProposalContext,
): StatementLike {
  const hasProposal = context.proposalId !== undefined;
  return prepareAuthorizationGuard(db, {
    sql: exactContextSql(hasProposal),
    bindings: hasProposal
      ? [context.groupId, context.groupId, context.eventId, context.proposalId]
      : [context.groupId, context.groupId, context.eventId],
  });
}

/** Rechecks the exact program tuple and permission in the same D1 batch as a page and count. */
export async function queryGroupEventProposalPage<T>(
  db: DatabaseLike,
  actor: AuthAdmin,
  context: GroupEventProposalContext,
  permission: Permission,
  query: OffsetPageQuery,
): Promise<{ rows: T[]; total: number }> {
  try {
    const [, , pageResult, countResult] = await db.batch([
      prepareGroupEventProposalContextGuard(db, context),
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission, context: { type: "event", id: context.eventId } },
      ]),
      ...buildOffsetPageStatements(db, query),
    ]);
    return decodeOffsetPageResults<T>(pageResult, countResult);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "GROUP_EVENT_PROPOSAL_CONTEXT_CHANGED",
        "Proposal-program access changed while the invitation list was loading",
      );
    }
    throw error;
  }
}
