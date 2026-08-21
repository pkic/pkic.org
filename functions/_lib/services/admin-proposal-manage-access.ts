import { getProposalAccessForEvent } from "../auth/proposal-access";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { writeAuditLog } from "./audit";
import { proposalManagePageUrl } from "./frontend-links";
import { refreshProposalManageToken } from "./proposals";

interface AdminProposalManageContext {
  id: string;
  event_id: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

export async function createAdminProposalManageUrl(
  db: DatabaseLike,
  payload: {
    actor: AuthAdmin;
    proposalId: string;
    signingSecret: string;
    appBaseUrl: string;
  },
): Promise<string> {
  const proposal = await first<AdminProposalManageContext>(
    db,
    `SELECT sp.id, sp.event_id, e.slug, e.base_path, e.starts_at,
            COALESCE(e.settings_json, '{}') AS settings_json
       FROM session_proposals sp
       JOIN events e ON e.id = sp.event_id
      WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [payload.proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, proposal.event_id, payload.actor);
  if (!access.canReview) throw new AppError(403, "FORBIDDEN", "Missing permission to manage proposals");

  const token = await refreshProposalManageToken(db, proposal.id, payload.signingSecret);
  await writeAuditLog(db, "admin", payload.actor.id, "admin_opened_proposal_manage_page", "proposal", proposal.id, {
    adminEmail: payload.actor.email,
    eventSlug: proposal.slug,
  });
  return proposalManagePageUrl(payload.appBaseUrl, proposal, token);
}
