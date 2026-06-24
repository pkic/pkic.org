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
import type { AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const _t0 = Date.now();
  const _log = (msg: string) => console.log(`[finalize-preview] ${msg} (+${Date.now() - _t0}ms)`);
  _log("START");
  // Use the raw DB binding for this read-only endpoint. The session-wrapped
  // requestDb(c) uses primaryFirstDb which creates a D1 session that does not
  // support the parallel queries this handler fires (layout + partials +
  // templates all in concurrent Promise.all calls), causing a hang in dev mode.
  const db = c.env.DB;
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  _log("admin authenticated");
  const proposalId = c.req.param("proposalId");

  const accessCheckProposal = await first<{ event_id: string }>(
    db,
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!accessCheckProposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(db, accessCheckProposal.event_id, admin);
  if (!access.canFinalize) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to finalize proposals" } }, 403);
  }
  _log("access checked");

  const body = await parseJsonBody(c.req, finalizeProposalSchema);
  _log(`building plan for finalStatus=${body.finalStatus}`);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const plan = await buildProposalDecisionEmailPlan(
    db,
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
  _log(`plan built: ${plan.messages.length} messages`);

  let layoutMissing = false;
  const [layoutHtml, partials] = await Promise.all([
    loadEmailLayout(db).catch(() => {
      layoutMissing = true;
      return "";
    }),
    loadEmailPartials(db).catch(() => ({}) as Record<string, string>),
  ]);
  _log("layout+partials loaded");

  const messages = await Promise.all(
    plan.messages.map(async (message) => {
      _log(`rendering ${message.templateKey} for ${message.recipientEmail}`);
      try {
        const template = await resolveTemplate(db, message.templateKey);
        _log(`template resolved: ${message.templateKey}`);
        const dataWithPartials = { ...message.data, _partials: partials };
        const subject = renderSubject(template.subjectTemplate, message.fallbackSubject, dataWithPartials);
        const rendered = await renderEmail(
          template.content,
          dataWithPartials,
          layoutHtml,
          template.contentType as "markdown" | "html" | "text",
          appBaseUrl,
        );
        _log(`rendered: ${message.templateKey}`);

        return {
          id: message.id,
          templateKey: message.templateKey,
          recipientEmail: message.recipientEmail,
          recipientLabel: message.recipientLabel,
          subject,
          html: rendered.html,
          text: rendered.text,
          templateMissing: false as const,
        };
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === "EMAIL_TEMPLATE_NOT_FOUND" || code === "EMAIL_TEMPLATE_MISSING_BODY") {
          return {
            id: message.id,
            templateKey: message.templateKey,
            recipientEmail: message.recipientEmail,
            recipientLabel: message.recipientLabel,
            subject: message.fallbackSubject,
            html: "",
            text: "",
            templateMissing: true as const,
          };
        }
        _log(`ERROR in ${message.templateKey}: ${(err as Error).message}`);
        throw err;
      }
    }),
  );
  _log("all messages rendered");

  const missingTemplateKeys = [...new Set(messages.filter((m) => m.templateMissing).map((m) => m.templateKey))];

  return json({
    success: true,
    recipientCount: new Set(messages.map((message) => message.recipientEmail)).size,
    emailCount: messages.length,
    layoutMissing,
    missingTemplateKeys,
    messages,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
