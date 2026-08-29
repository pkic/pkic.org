import { getProposalAccessForEvent } from "../auth/proposal-access";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { newCapabilityLinkSecret, signCapabilityToken } from "./capability-links";
import { proposalManagePageUrl } from "./frontend-links";

interface ProposalAccessLinkContext {
  id: string;
  event_id: string;
  manage_link_secret: string | null;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

export async function createProposalAccessLink(
  db: DatabaseLike,
  payload: {
    actor: AuthAdmin;
    proposalId: string;
    signingSecret: string;
    appBaseUrl: string;
  },
): Promise<string> {
  const proposal = await first<ProposalAccessLinkContext>(
    db,
    `SELECT sp.id, sp.event_id, sp.manage_link_secret, e.slug, e.base_path, e.starts_at,
            COALESCE(e.settings_json, '{}') AS settings_json
       FROM session_proposals sp
       JOIN events e ON e.id = sp.event_id
      WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [payload.proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, proposal.event_id, payload.actor);
  if (!access.canFinalize) throw new AppError(403, "FORBIDDEN", "Missing permission to manage proposals");

  const manageLinkSecret = newCapabilityLinkSecret();
  const token = await signCapabilityToken({
    signingSecret: payload.signingSecret,
    linkSecret: manageLinkSecret,
    purpose: "proposal_manage",
    resourceId: proposal.id,
  });
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, payload.actor, [
        { permission: "proposals:manage", context: { type: "event", id: proposal.event_id } },
      ]),
      db
        .prepare(
          `UPDATE session_proposals
              SET manage_link_secret = ?
            WHERE id = ? AND event_id = ? AND deleted_at IS NULL
              AND manage_link_secret IS ?`,
        )
        .bind(manageLinkSecret, proposal.id, proposal.event_id, proposal.manage_link_secret),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        payload.actor.id,
        "proposal_access_link_issued",
        "proposal",
        proposal.id,
        { actorEmail: payload.actor.email, eventSlug: proposal.slug },
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_AUTHORIZATION_CHANGED",
        "Proposal management permission changed while the manage link was being issued",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_MANAGE_LINK_CONFLICT",
        "Proposal changed while the manage link was being issued",
      );
    }
    throw error;
  }
  return proposalManagePageUrl(payload.appBaseUrl, proposal, token);
}
