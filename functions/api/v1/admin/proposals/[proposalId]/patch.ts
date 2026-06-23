/**
 * Admin: update a proposal's title and/or abstract.
 *
 * PATCH /api/v1/admin/proposals/:proposalId
 *
 * Requires the admin to have the "organizer" event permission (canFinalize).
 * Only title and abstract can be updated via this endpoint.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { first, run } from "../../../../../_lib/db/queries";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { adminProposalPatchSchema } from "../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string; event_id: string; title: string; abstract: string; requires_presentation: number | null }>(
    requestDb(c),
    "SELECT id, event_id, title, abstract, requires_presentation FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canFinalize) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to edit proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, adminProposalPatchSchema);

  const requiresPresentation = body.requiresPresentation != null ? (body.requiresPresentation ? 1 : 0) : null;

  await run(
    requestDb(c),
    `UPDATE session_proposals
     SET title                  = COALESCE(?, title),
         abstract               = COALESCE(?, abstract),
         requires_presentation  = COALESCE(?, requires_presentation),
         updated_at             = datetime('now')
     WHERE id = ?`,
    [body.title ?? null, body.abstract ?? null, requiresPresentation, proposalId],
  );

  const updated = await first<{ id: string; title: string; abstract: string; updated_at: string; requires_presentation: number | null }>(
    requestDb(c),
    "SELECT id, title, abstract, updated_at, requires_presentation FROM session_proposals WHERE id = ?",
    [proposalId],
  );

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (updated) {
    if (body.title != null && proposal.title !== updated.title) {
      changes.title = { from: proposal.title, to: updated.title };
    }
    if (body.abstract != null && proposal.abstract !== updated.abstract) {
      changes.abstract = { from: proposal.abstract, to: updated.abstract };
    }
    if (body.requiresPresentation != null && proposal.requires_presentation !== updated.requires_presentation) {
      changes.requiresPresentation = { from: Boolean(proposal.requires_presentation), to: body.requiresPresentation };
    }
  }

  if (Object.keys(changes).length > 0) {
    await writeAuditLog(requestDb(c), "admin", admin.id, "proposal_edited", "proposal", proposalId, changes);
  }

  return json({ proposal: updated });
}
