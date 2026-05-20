import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { first } from "../../../../../_lib/db/queries";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { resolveTemplate } from "../../../../../_lib/email/templates";
import { renderEmail, renderSubject } from "../../../../../_lib/email/render";
import { loadEmailLayout, loadEmailPartials } from "../../../../../_lib/email/partials";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { finalizeProposalSchema } from "../../../../../../assets/shared/schemas/api";
import { buildProposalDecisionEmailPlan } from "./decision-emails";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const accessCheckProposal = await first<{ event_id: string }>(
    requestDb(c),
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!accessCheckProposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), accessCheckProposal.event_id, admin);
  if (!access.canFinalize) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to finalize proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, finalizeProposalSchema);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const plan = await buildProposalDecisionEmailPlan(
    requestDb(c),
    {
      proposalId,
      finalStatus: body.finalStatus,
      decisionNote: body.decisionNote,
      presentationDeadline: body.presentationDeadline,
    },
    {
      appBaseUrl,
      resolveSpeakerManageUrl: async (speaker, event) =>
        speakerManagePageUrl(appBaseUrl, event, speaker.manage_token_hash ?? ""),
      resolveProposalManageUrl: async (event, proposalManageToken) =>
        proposalManagePageUrl(appBaseUrl, event, proposalManageToken),
    },
  );

  const [layoutHtml, partials] = await Promise.all([loadEmailLayout(requestDb(c)), loadEmailPartials(requestDb(c))]);

  const messages = await Promise.all(
    plan.messages.map(async (message) => {
      const template = await resolveTemplate(requestDb(c), message.templateKey);
      const dataWithPartials = { ...message.data, _partials: partials };
      const subject = renderSubject(template.subjectTemplate, message.fallbackSubject, dataWithPartials);
      const rendered = await renderEmail(
        template.content,
        dataWithPartials,
        layoutHtml,
        template.contentType as "markdown" | "html" | "text",
        appBaseUrl,
      );

      return {
        id: message.id,
        templateKey: message.templateKey,
        recipientEmail: message.recipientEmail,
        recipientLabel: message.recipientLabel,
        subject,
        html: rendered.html,
        text: rendered.text,
      };
    }),
  );

  return json({
    success: true,
    recipientCount: new Set(messages.map((message) => message.recipientEmail)).size,
    emailCount: messages.length,
    messages,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
