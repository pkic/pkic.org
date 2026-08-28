import { json } from "../../../../_lib/http";
import { renderEmail, renderSubject } from "../../../../_lib/email/render";
import { loadEmailPartials, loadEmailRenderResources } from "../../../../_lib/email/partials";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import {
  emailTemplatePreviewResponseSchema,
  emailTemplatePreviewRouteSchema,
} from "../../../../../assets/shared/schemas/email-templates";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import { requireSystemPermission } from "../authorization";

function buildDefaultPreviewData(baseUrl: string): Record<string, unknown> {
  return {
    eventName: "PKI Consortium Summit 2026",
    eventUrl: `${baseUrl}/example/event/`,
    firstName: "Alex",
    lastName: "Morgan",
    proposalTitle: "Operational Trust in a Post-Quantum Transition",
    finalStatus: "needs-work",
    decisionNote: "Please update the proposal with measurable outcomes and migration constraints.",
    // Preview-only placeholders. Real links are generated from event route settings/frontmatter.
    manageUrl: `${baseUrl}/example/manage/?token=example`,
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

async function handlePreviewPost(
  c: AdminContext,
  data: ValidatedData<typeof emailTemplatePreviewRouteSchema>,
): Promise<Response> {
  const { db } = await requireSystemPermission(c, "email-templates:write");
  const body = data.body;
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const renderData = {
    ...buildDefaultPreviewData(appBaseUrl),
    ...(body.data ?? {}),
  };
  const resources = body.layoutHtml
    ? { partials: await loadEmailPartials(db), layoutHtml: body.layoutHtml }
    : await loadEmailRenderResources(db);
  const { partials, layoutHtml } = resources;
  const dataWithPartials = { ...renderData, _partials: partials };

  const subject = renderSubject(body.subjectTemplate ?? null, "PKI Consortium Preview Subject", dataWithPartials);

  const rendered = await renderEmail(body.content, dataWithPartials, layoutHtml, body.contentType, appBaseUrl);

  return json(
    emailTemplatePreviewResponseSchema.parse({
      success: true,
      subject,
      html: rendered.html,
      text: rendered.text,
      data: renderData,
    }),
  );
}

export const EmailTemplatePreviewPost = openApiRoute(emailTemplatePreviewRouteSchema, handlePreviewPost);
