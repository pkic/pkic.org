import type { ProposalDecisionPreviewResponse } from "../../../../assets/shared/schemas/admin-event-proposals";
import type { ProposalDecisionStatus } from "../../../../assets/shared/schemas/proposal-status";
import type { EmailContentType } from "../../../../assets/shared/schemas/admin-email-templates";
import { loadEmailLayout, loadEmailPartials } from "../../email/partials";
import { renderEmail, renderSubject } from "../../email/render";
import { resolveTemplate } from "../../email/templates";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { buildProposalDecisionEmailPlan } from "./email-plan";

export async function previewProposalDecisionEmails(
  db: DatabaseLike,
  input: {
    proposalId: string;
    actor: AuthAdmin;
    finalStatus: ProposalDecisionStatus;
    decisionNote?: string;
    presentationDeadline?: string;
  },
  options: Parameters<typeof buildProposalDecisionEmailPlan>[2],
): Promise<ProposalDecisionPreviewResponse> {
  const plan = await buildProposalDecisionEmailPlan(db, input, options);
  let layoutMissing = false;
  const [layoutHtml, partials] = await Promise.all([
    loadEmailLayout(db).catch(() => {
      layoutMissing = true;
      return "";
    }),
    loadEmailPartials(db).catch(() => ({}) as Record<string, string>),
  ]);
  const messages = await Promise.all(
    plan.messages.map(async (message) => {
      try {
        const template = await resolveTemplate(db, message.templateKey);
        const data = { ...message.data, _partials: partials };
        const subject = renderSubject(template.subjectTemplate, message.fallbackSubject, data);
        const rendered = await renderEmail(
          template.content,
          data,
          layoutHtml,
          template.contentType as EmailContentType,
          options.appBaseUrl,
        );
        return { ...message, subject, html: rendered.html, text: rendered.text, templateMissing: false as const };
      } catch (error: unknown) {
        const code = (error as { code?: string }).code;
        if (code !== "EMAIL_TEMPLATE_NOT_FOUND" && code !== "EMAIL_TEMPLATE_MISSING_BODY") throw error;
        return {
          ...message,
          subject: message.fallbackSubject,
          html: "",
          text: "",
          templateMissing: true as const,
        };
      }
    }),
  );

  return {
    success: true,
    recipientCount: new Set(messages.map((message) => message.recipientEmail)).size,
    emailCount: messages.length,
    layoutMissing,
    missingTemplateKeys: [...new Set(messages.filter((message) => message.templateMissing).map((m) => m.templateKey))],
    messages,
  };
}
