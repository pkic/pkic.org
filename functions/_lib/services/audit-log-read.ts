import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type { AuditLogListQuery } from "../../../assets/shared/schemas/admin-audit-log";
import type { ScopedAuditLogListQuery } from "../../../assets/shared/schemas/audit-log";
import { first } from "../db/queries";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { toAuditLogResponseRows, type AuditLogReadRow } from "./audit";

type AuditLogPageQuery = AuditLogListQuery;

interface AuditLogRestriction {
  joins?: string;
  where?: string;
  bindings?: readonly unknown[];
}

interface AuditLogSortPolicy {
  expressions: Readonly<Record<string, string>>;
  fallback: string;
}

const SCOPED_AUDIT_SORT_POLICY: AuditLogSortPolicy = {
  expressions: {
    createdAt: "al.created_at",
    action: "al.action COLLATE NOCASE",
    actor: "actor_display COLLATE NOCASE",
  },
  fallback: "al.created_at DESC",
};

function exactAuditScopeRestriction(scopeType: string, scopeId: string): AuditLogRestriction {
  return {
    where: "al.scope_type = ? AND al.scope_id = ?",
    bindings: [scopeType, scopeId],
  };
}

/** One page/count query builder shared by global, entity, and group audit lists. */
export function buildAuditLogPageQuery(
  query: AuditLogPageQuery,
  restriction: AuditLogRestriction,
  sortPolicy: AuditLogSortPolicy,
) {
  const conditions = restriction.where ? [`(${restriction.where})`] : [];
  const bindings: unknown[] = [...(restriction.bindings ?? [])];
  const exactFilters = [
    ["al.entity_type", query.entityType],
    ["al.actor_type", query.actorType],
    ["al.action", query.action],
    ["al.entity_id", query.entityId],
  ] as const;
  for (const [column, value] of exactFilters) {
    if (!value) continue;
    conditions.push(`${column} = ?`);
    bindings.push(value);
  }
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        "al.action",
        "al.entity_id",
        "al.entity_type",
        "al.details_json",
        "u.email",
        "u.first_name",
        "u.last_name",
        "u.first_name || ' ' || u.last_name",
      ])
    : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return {
    source: {
      selectSql: `SELECT
        al.id,
        al.actor_type,
        al.actor_id,
        COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS actor_display,
        al.action,
        al.entity_type,
        al.entity_id,
        al.details_json,
        al.created_at`,
      fromSql: `FROM audit_log al
    LEFT JOIN users u ON al.actor_type = 'admin' AND u.id = al.actor_id
    ${restriction.joins ?? ""}
    ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(query.sort, sortPolicy.expressions, sortPolicy.fallback, "al.id ASC"),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listAuditLogPage(
  db: DatabaseLike,
  query: AuditLogPageQuery,
  restriction: AuditLogRestriction,
  sortPolicy: AuditLogSortPolicy,
) {
  const { rows, total } = await queryPage<AuditLogReadRow>(db, buildAuditLogPageQuery(query, restriction, sortPolicy));
  const auditLog = toAuditLogResponseRows(rows);
  return { auditLog, page: buildPageInfo(query.limit, query.offset, total, auditLog.length) };
}

async function listAuditLogForScope(db: DatabaseLike, query: ScopedAuditLogListQuery, scope: AuditLogRestriction) {
  return listAuditLogPage(db, query, scope, SCOPED_AUDIT_SORT_POLICY);
}

export async function listExactAuditLogScope(
  db: DatabaseLike,
  scopeType: string,
  scopeId: string,
  query: ScopedAuditLogListQuery,
) {
  return listAuditLogForScope(db, query, exactAuditScopeRestriction(scopeType, scopeId));
}

/** Exact-scope variant exposed for D1 query-plan assertions. */
export function buildExactScopedAuditLogPageQuery(scopeType: string, scopeId: string, query: ScopedAuditLogListQuery) {
  return buildAuditLogPageQuery(query, exactAuditScopeRestriction(scopeType, scopeId), SCOPED_AUDIT_SORT_POLICY);
}

export async function listProposalAuditLog(db: DatabaseLike, proposalId: string, query: ScopedAuditLogListQuery) {
  if (!(await first<{ id: string }>(db, "SELECT id FROM session_proposals WHERE id = ?", [proposalId]))) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }
  return listAuditLogForScope(db, query, {
    joins: `LEFT JOIN proposal_reviews pr ON al.entity_type = 'proposal_review' AND pr.id = al.entity_id
      LEFT JOIN proposal_speakers ps ON al.entity_type = 'proposal_speaker' AND ps.id = al.entity_id`,
    where: `((al.scope_type = 'proposal' AND al.scope_id = ?)
      OR (al.scope_type IS NULL AND (
        (al.entity_type = 'proposal' AND al.entity_id = ?)
        OR (al.entity_type = 'proposal_review' AND pr.proposal_id = ?)
        OR (al.entity_type = 'proposal_speaker' AND ps.proposal_id = ?)
      )))`,
    bindings: [proposalId, proposalId, proposalId, proposalId],
  });
}

export async function listRegistrationAuditLog(
  db: DatabaseLike,
  eventId: string,
  registrationId: string,
  query: ScopedAuditLogListQuery,
) {
  const registration = await first<{ id: string }>(db, "SELECT id FROM registrations WHERE id = ? AND event_id = ?", [
    registrationId,
    eventId,
  ]);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  return listAuditLogForScope(db, query, {
    joins: "",
    where: "al.entity_type = 'registration' AND al.entity_id = ?",
    bindings: [registrationId],
  });
}
