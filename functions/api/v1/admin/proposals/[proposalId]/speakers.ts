/**
 * Admin: list all speakers for a proposal with their participation status.
 *
 * GET /api/v1/admin/proposals/[proposalId]/speakers
 *
 * Response includes per-speaker:
 *   - role, status (pending | invited | confirmed | declined)
 *   - profile completeness (bio, headshot)
 *   - presentation upload status
 *   - confirmation / decline timestamps
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import {
  listProposalSpeakersWithStatus,
} from "../../../../../_lib/services/proposals";
import { first } from "../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../_lib/types";

export async function onRequestGet(
  context: PagesContext<{ proposalId: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request);

  const proposal = await first<{
    id: string;
    title: string;
    status: string;
    event_id: string;
    presentation_deadline: string | null;
    presentation_r2_key: string | null;
    presentation_uploaded_at: string | null;
  }>(
    context.env.DB,
    `SELECT id, title, status, event_id,
            presentation_deadline, presentation_r2_key, presentation_uploaded_at
     FROM session_proposals WHERE id = ?`,
    [context.params.proposalId],
  );

  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const speakers = await listProposalSpeakersWithStatus(context.env.DB, context.params.proposalId);

  // Summarise participation completeness for the admin overview.
  const summary = {
    total: speakers.length,
    confirmed: speakers.filter((s) => s.status === "confirmed").length,
    pending: speakers.filter((s) => s.status === "pending" || s.status === "invited").length,
    declined: speakers.filter((s) => s.status === "declined").length,
    profileComplete: speakers.filter((s) => Boolean(s.biography) && Boolean(s.headshot_r2_key)).length,
    presentationUploaded: proposal.presentation_r2_key ? 1 : 0,
  };

  return json({
    proposal: {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      presentationDeadline: proposal.presentation_deadline,
      presentationUploaded: Boolean(proposal.presentation_r2_key),
      presentationUploadedAt: proposal.presentation_uploaded_at,
    },
    summary,
    speakers: speakers.map((s) => ({
      userId: s.user_id,
      role: s.role,
      status: s.status,
      email: s.email,
      firstName: s.first_name,
      lastName: s.last_name,
      organizationName: s.organization_name,
      jobTitle: s.job_title,
      confirmedAt: s.confirmed_at,
      declinedAt: s.declined_at,
      declineReason: s.decline_reason,
      termsAcceptedAt: s.terms_accepted_at,
      addedAt: s.created_at,
      profileComplete: Boolean(s.biography) && Boolean(s.headshot_r2_key),
      hasHeadshot: Boolean(s.headshot_r2_key),
      hasBio: Boolean(s.biography),
      headshotUpdatedAt: s.headshot_updated_at,
    })),
  });
}

export async function onRequest(
  context: PagesContext<{ proposalId: string }>,
): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
