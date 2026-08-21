import type { ProposalDecisionPreviewResponse } from "../../../../assets/shared/schemas/admin-event-proposals";
import type { ProposalDecisionStatus } from "../../../../assets/shared/schemas/proposal-status";
import type { EmailContentType } from "../../../../assets/shared/schemas/admin-email-templates";
import {
  EMAIL_LAYOUT_TEMPLATE_KEY,
  EMAIL_PARTIAL_TEMPLATE_KEYS,
  emailPartialsFromResolutions,
} from "../../email/partials";
import { renderEmail, renderSubject } from "../../email/render";
import { resolveTemplateSet } from "../../email/templates";
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
  const resolutions = await resolveTemplateSet(db, [
    EMAIL_LAYOUT_TEMPLATE_KEY,
    ...EMAIL_PARTIAL_TEMPLATE_KEYS,
    ...plan.messages.map((message) => message.templateKey),
  ]);
  const layoutResolution = resolutions.get(EMAIL_LAYOUT_TEMPLATE_KEY);
  const layoutMissing = !layoutResolution?.ok;
  const layoutHtml = layoutResolution?.ok ? layoutResolution.template.content : "";
  const partials = emailPartialsFromResolutions(resolutions);
  const messages = await Promise.all(
    plan.messages.map(async (message) => {
      const resolution = resolutions.get(message.templateKey);
      if (!resolution?.ok) {
        return {
          ...message,
          subject: message.fallbackSubject,
          html: "",
          text: "",
          templateMissing: true as const,
        };
      }
      const template = resolution.template;
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
