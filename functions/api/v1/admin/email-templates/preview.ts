import { parseJsonBody } from "../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { renderEmail, renderSubject } from "../../../../_lib/email/render";
import { loadEmailPartials, loadEmailRenderResources } from "../../../../_lib/email/partials";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import {
  adminEmailTemplatePreviewResponseSchema,
  adminEmailTemplatePreviewRouteSchema,
  adminEmailTemplatePreviewSchema,
} from "../../../../../assets/shared/schemas/admin-email-templates";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";

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

export async function onRequestPost(
  c: AdminContext,
  validated?: ValidatedData<typeof adminEmailTemplatePreviewRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  const body = validated?.body ?? (await parseJsonBody(c.req, adminEmailTemplatePreviewSchema));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const data = {
    ...buildDefaultPreviewData(appBaseUrl),
    ...(body.data ?? {}),
  };
  const resources = body.layoutHtml
    ? { partials: await loadEmailPartials(db), layoutHtml: body.layoutHtml }
    : await loadEmailRenderResources(db);
  const { partials, layoutHtml } = resources;
  const dataWithPartials = { ...data, _partials: partials };

  const subject = renderSubject(body.subjectTemplate ?? null, "PKI Consortium Preview Subject", dataWithPartials);

  const rendered = await renderEmail(body.content, dataWithPartials, layoutHtml, body.contentType, appBaseUrl);

  return json(
    adminEmailTemplatePreviewResponseSchema.parse({
      success: true,
      subject,
      html: rendered.html,
      text: rendered.text,
      data,
    }),
  );
}

export const AdminEmailTemplatePreviewPost = openApiRoute(adminEmailTemplatePreviewRouteSchema, onRequestPost);

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
