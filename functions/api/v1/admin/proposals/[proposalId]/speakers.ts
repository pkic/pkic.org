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
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { listProposalSpeakersWithStatus } from "../../../../../_lib/services/proposals";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { first } from "../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{
    id: string;
    title: string;
    status: string;
    event_id: string;
    presentation_deadline: string | null;
    presentation_r2_key: string | null;
    presentation_uploaded_at: string | null;
  }>(
    requestDb(c),
    `SELECT id, title, status, event_id,
            presentation_deadline, presentation_r2_key, presentation_uploaded_at
     FROM session_proposals WHERE id = ?`,
    [proposalId],
  );

  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const speakers = await listProposalSpeakersWithStatus(requestDb(c), proposalId);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

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
      biography: s.biography,
      links: s.links_json ? JSON.parse(s.links_json) : [],
      headshotUrl: s.headshot_r2_key
        ? (() => {
            const urlPath = s.headshot_r2_key.split("/").slice(1).join("/");
            const v = s.headshot_updated_at ? `?v=${encodeURIComponent(s.headshot_updated_at)}` : "";
            return `${appBaseUrl}/api/v1/headshots/${urlPath}${v}`;
          })()
        : null,
      headshotUpdatedAt: s.headshot_updated_at,
    })),
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
