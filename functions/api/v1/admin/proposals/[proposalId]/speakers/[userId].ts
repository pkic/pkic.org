/**
 * Admin: update a speaker's bio on a proposal.
 *
 * PATCH /api/v1/admin/proposals/:proposalId/speakers/:userId
 *
 * Requires canReview permission on the event.
 */
import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../../_lib/auth/proposal-access";
import { updateSpeakerProfile } from "../../../../../../_lib/services/proposals-speaker-profile";
import { first } from "../../../../../../_lib/db/queries";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { adminSpeakerBioPatchSchema } from "../../../../../../../assets/shared/schemas/api";

export async function onRequestPatch(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const proposalId = c.req.param("proposalId");
  const userId = c.req.param("userId");

  const proposal = await first<{ event_id: string }>(c.env.DB, "SELECT event_id FROM session_proposals WHERE id = ?", [
    proposalId,
  ]);
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(c.env.DB, proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to edit speaker profiles" } }, 403);
  }

  const speaker = await first<{ user_id: string }>(
    c.env.DB,
    "SELECT user_id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
    [proposalId, userId],
  );
  if (!speaker) {
    return json({ error: { code: "SPEAKER_NOT_FOUND", message: "Speaker not found on this proposal" } }, 404);
  }

  const body = await parseJsonBody(c.req, adminSpeakerBioPatchSchema);
  await updateSpeakerProfile(c.env.DB, userId, { biography: body.biography ?? undefined });

  await writeAuditLog(c.env.DB, "admin", admin.id, "speaker_bio_updated", "proposal", proposalId, {
    speakerUserId: userId,
    adminEmail: admin.email,
  });

  return json({ success: true });
}
