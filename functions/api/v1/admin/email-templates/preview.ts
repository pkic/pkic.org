import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { renderEmail, renderSubject } from "../../../../_lib/email/render";
import { loadEmailLayout, loadEmailPartials } from "../../../../_lib/email/partials";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import type { PagesContext } from "../../../../_lib/types";
import { adminEmailTemplatePreviewSchema } from "../../../../../assets/shared/schemas/api";

function buildDefaultPreviewData(baseUrl: string): Record<string, unknown> {
  return {
    eventName: "PKI Consortium Summit 2026",
    eventUrl: `${baseUrl}/example/event/`,
    firstName: "Alex",
    lastName: "Morgan",
    proposalTitle: "Operational Trust in a Post-Quantum Transition",
    // Preview-only placeholders. Real links are generated from event route settings/frontmatter.
    registrationUrl: `${baseUrl}/example/registration-link/`,
    proposalUrl: `${baseUrl}/example/proposal-link/`,
    uploadUrl: `${baseUrl}/example/upload-link/`,
    profileUrl: `${baseUrl}/example/profile-link/`,
    declineUrl: `${baseUrl}/example/decline-link/?token=example`,
    deadline: "2026-05-15",
    daysUntilExpiry: "5",
    daysUntilDeadline: "7",
    reminderCount: "2",
    isReminder: true,
  };
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminEmailTemplatePreviewSchema);
  const appBaseUrl = resolveAppBaseUrl(context.env);

  const data = {
    ...buildDefaultPreviewData(appBaseUrl),
    ...(body.data ?? {}),
  };
  const partials = await loadEmailPartials(context.env.DB);
  const layoutHtml = body.layoutHtml ?? await loadEmailLayout(context.env.DB);
  const dataWithPartials = { ...data, _partials: partials };

  const subject = renderSubject(
    body.subjectTemplate ?? null,
    "PKI Consortium Preview Subject",
    dataWithPartials,
  );

  const rendered = await renderEmail(
    body.content,
    dataWithPartials,
    layoutHtml,
    body.contentType,
    appBaseUrl,
  );

  return json({
    success: true,
    subject,
    html: rendered.html,
    text: rendered.text,
    data,
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}
