/**
 * Admin: update a speaker's profile on a proposal.
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
import { updateProposalSpeakerRole } from "../../../../../../_lib/services/proposals";
import { first } from "../../../../../../_lib/db/queries";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { adminSpeakerBioPatchSchema } from "../../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  const userId = c.req.param("userId");

  const proposal = await first<{ event_id: string }>(
    requestDb(c),
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to edit speaker profiles" } }, 403);
  }

  const speaker = await first<{
    user_id: string;
    role: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    requestDb(c),
    `SELECT ps.user_id, ps.role,
            u.first_name, u.last_name, u.organization_name, u.job_title, u.biography, u.links_json
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id = ?`,
    [proposalId, userId],
  );
  if (!speaker) {
    return json({ error: { code: "SPEAKER_NOT_FOUND", message: "Speaker not found on this proposal" } }, 404);
  }

  const body = await parseJsonBody(c.req, adminSpeakerBioPatchSchema);
  await updateSpeakerProfile(requestDb(c), userId, {
    firstName: body.firstName === undefined ? undefined : body.firstName || null,
    lastName: body.lastName === undefined ? undefined : body.lastName || null,
    organizationName: body.organizationName === undefined ? undefined : body.organizationName || null,
    jobTitle: body.jobTitle === undefined ? undefined : body.jobTitle || null,
    biography: body.biography === undefined ? undefined : body.biography || null,
    linksJson:
      body.links === undefined ? undefined : body.links && body.links.length > 0 ? JSON.stringify(body.links) : null,
  });
  if (body.role && body.role !== speaker.role) {
    await updateProposalSpeakerRole(requestDb(c), { proposalId, userId, role: body.role });
  }

  const changes: Record<string, unknown> = {
    speakerUserId: userId,
    adminEmail: admin.email,
  };
  if (body.firstName !== undefined && (body.firstName || null) !== speaker.first_name) {
    changes.firstName = { from: speaker.first_name, to: body.firstName || null };
  }
  if (body.lastName !== undefined && (body.lastName || null) !== speaker.last_name) {
    changes.lastName = { from: speaker.last_name, to: body.lastName || null };
  }
  if (body.organizationName !== undefined && (body.organizationName || null) !== speaker.organization_name) {
    changes.organizationName = { from: speaker.organization_name, to: body.organizationName || null };
  }
  if (body.jobTitle !== undefined && (body.jobTitle || null) !== speaker.job_title) {
    changes.jobTitle = { from: speaker.job_title, to: body.jobTitle || null };
  }
  if (body.biography !== undefined && (body.biography || null) !== speaker.biography) {
    changes.biography = { from: speaker.biography, to: body.biography || null };
  }
  if (body.links !== undefined) {
    const previousLinks = speaker.links_json ? JSON.parse(speaker.links_json) : [];
    changes.links = { from: previousLinks, to: body.links ?? [] };
  }
  if (body.role && body.role !== speaker.role) {
    changes.role = { from: speaker.role, to: body.role };
  }

  await writeAuditLog(requestDb(c), "admin", admin.id, "speaker_profile_updated", "proposal", proposalId, changes);

  return json({ success: true });
}
