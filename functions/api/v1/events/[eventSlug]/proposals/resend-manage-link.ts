/**
 * POST /api/v1/events/:eventSlug/proposals/resend-manage-link
 *
 * Sends fresh proposer-management links for active proposals matching the
 * provided email. The generic response prevents account enumeration.
 */
import { OpenAPIRoute } from "chanfana";
import { all } from "../../../../../_lib/db/queries";
import { prepareBulkQueueEmailStatements, processSelectedOutboxBackground } from "../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { json } from "../../../../../_lib/http";
import { getClientIp } from "../../../../../_lib/request";
import { enforceRateLimit } from "../../../../../_lib/rate-limit";
import { queuedCapabilityToken } from "../../../../../_lib/services/capability-links";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../_lib/services/events";
import { proposalManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { bulkBuildProposalInviteEmailContexts } from "../../../../../_lib/services/reminders/shared";
import { parseJsonBody } from "../../../../../_lib/validation";
import { proposalResendManageLinkSchema } from "../../../../../../assets/shared/schemas/api";
import { proposalResendManageLinkRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";

interface ProposalMatch {
  proposal_id: string;
  proposer_user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  title: string;
  abstract: string;
  proposal_type: string;
}

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);

  const body = await parseJsonBody(c.req, proposalResendManageLinkSchema);
  await enforceRateLimit({
    binding: c.env.EMAIL_RATE_LIMITER,
    namespace: "proposal-resend-manage-link:email",
    key: body.email,
  });
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "proposal-resend-manage-link:ip",
    key: getClientIp(c.req.raw),
  });

  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const proposals = await all<ProposalMatch>(
    c.env.DB,
    `SELECT
       sp.id AS proposal_id,
       sp.proposer_user_id,
       u.email,
       u.first_name,
       u.last_name,
       sp.title,
       sp.abstract,
       sp.proposal_type
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     WHERE sp.event_id = ?
       AND lower(u.email) = lower(?)
       AND sp.status NOT IN ('rejected', 'withdrawn')
     ORDER BY sp.submitted_at DESC
     LIMIT 20`,
    [event.id, body.email],
  );

  if (proposals.length > 0) {
    const proposalIds = proposals.map((proposal) => proposal.proposal_id);
    const [inviteContexts, referralRows] = await Promise.all([
      bulkBuildProposalInviteEmailContexts(c.env.DB, proposalIds),
      all<{ owner_id: string; code: string }>(
        c.env.DB,
        `SELECT owner_id, code
         FROM referral_codes
         WHERE event_id = ?
           AND owner_type = 'proposal'
           AND owner_id IN (SELECT value FROM json_each(?))
         ORDER BY created_at ASC`,
        [event.id, JSON.stringify(proposalIds)],
      ),
    ]);
    const referralByProposal = new Map<string, string>();
    for (const referral of referralRows) {
      if (!referralByProposal.has(referral.owner_id)) referralByProposal.set(referral.owner_id, referral.code);
    }

    const queueRows = proposals.map((proposal) => {
      const inviteContext = inviteContexts.get(proposal.proposal_id);
      const manageUrl = proposalManagePageUrl(
        appBaseUrl,
        event,
        queuedCapabilityToken("proposal_manage", proposal.proposal_id),
      );
      const referralCode = referralByProposal.get(proposal.proposal_id);
      return {
        eventId: event.id,
        templateKey: "proposal_submitted",
        recipientEmail: proposal.email,
        recipientUserId: proposal.proposer_user_id,
        messageType: "transactional" as const,
        subject: `Your proposal management link for ${event.name}: ${proposal.title}`,
        capabilityLinkValues: [manageUrl],
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: proposal.first_name ?? "",
          lastName: proposal.last_name ?? "",
          proposalTitle: proposal.title,
          proposalAbstract: proposal.abstract,
          proposalType: proposal.proposal_type,
          speakerLineupText: inviteContext?.speakerLineupText ?? "",
          manageUrl,
          shareUrl: referralCode ? `${appBaseUrl}/r/${referralCode}` : "",
        },
      };
    });
    const preparedRows = prepareBulkQueueEmailStatements(c.env.DB, queueRows);
    await c.env.DB.batch(preparedRows.map((row) => row.statement));
    c.executionCtx.waitUntil(
      processSelectedOutboxBackground(
        c.env.DB,
        c.env,
        preparedRows.map((row) => row.id),
      ),
    );
  }

  return json({ success: true });
}

export class EventsEventSlugProposalsResendManageLinkPost extends OpenAPIRoute {
  schema = proposalResendManageLinkRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
