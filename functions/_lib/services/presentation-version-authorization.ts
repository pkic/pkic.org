import type { Permission } from "../auth/permissions";
import { preparePermissionsAuthorizationGuard, requirePermission } from "../auth/permissions";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";

export interface PresentationProposalContext {
  id: string;
  event_id: string;
  status: string;
  updated_at: string;
  title: string;
  event_slug: string;
  presentation_deadline: string | null;
}

/** Live staff authorization for a proposal presentation operation. */
export interface PresentationVersionAuthorization {
  actor: AuthAdmin;
  permission: Extract<Permission, "proposals:read" | "proposals:manage">;
  /** Optional path event binding; when provided it must still match the proposal. */
  eventId?: string;
  /** Optional path proposal binding, required for version-scoped operations. */
  proposalId?: string;
}

export async function getPresentationProposalContext(
  db: DatabaseLike,
  proposalId: string,
): Promise<PresentationProposalContext> {
  const proposal = await first<PresentationProposalContext>(
    db,
    `SELECT sp.id, sp.event_id, sp.status, sp.updated_at, sp.title, sp.presentation_deadline, e.slug AS event_slug
     FROM session_proposals sp
     JOIN events e ON e.id = sp.event_id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  return proposal;
}

function presentationResourceGuard(
  db: DatabaseLike,
  proposalId: string,
  eventId: string,
  versionId?: string,
): StatementLike {
  if (versionId) {
    return prepareAuthorizationGuard(db, {
      sql: `SELECT 1
              FROM presentation_versions pv
              JOIN session_proposals sp ON sp.id = pv.proposal_id
             WHERE pv.id = ? AND pv.proposal_id = ? AND sp.event_id = ?
               AND pv.deleted_at IS NULL AND sp.deleted_at IS NULL`,
      bindings: [versionId, proposalId, eventId],
    });
  }
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM session_proposals
           WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    bindings: [proposalId, eventId],
  });
}

export function presentationAuthorizationGuards(
  db: DatabaseLike,
  proposalId: string,
  eventId: string,
  authorization: PresentationVersionAuthorization,
  versionId?: string,
): StatementLike[] {
  return [
    presentationResourceGuard(db, proposalId, eventId, versionId),
    preparePermissionsAuthorizationGuard(db, authorization.actor, [
      { permission: authorization.permission, context: { type: "event", id: eventId } },
    ]),
  ];
}

export function presentationAuthorizationChanged(): AppError {
  return new AppError(
    409,
    "PRESENTATION_AUTHORIZATION_CHANGED",
    "Presentation access changed while the operation was being completed",
  );
}

export function requirePresentationAuthorization(
  authorization: PresentationVersionAuthorization,
  eventId: string,
): void {
  requirePermission(authorization.actor, authorization.permission, { type: "event", id: eventId });
}
