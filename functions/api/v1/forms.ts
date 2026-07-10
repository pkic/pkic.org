/**
 * POST /api/v1/forms
 *
 * Receives multipart/form-data submissions from the join-membership form
 * (layouts/shortcodes/joinform.html) and the sponsor-interest form
 * (layouts/shortcodes/sponsorform.html), and files each one as a GitHub
 * issue in pkic/members.
 *
 * These are plain `<form method="POST">` submissions, not fetch() calls —
 * the browser navigates on submit, so the response here is always a
 * redirect back to the referring page with ?status=success or
 * ?status=error, never a JSON error body. The referer's origin is
 * validated against ALLOWED_ORIGINS before it's ever used as a redirect
 * target, so this can't be abused as an open redirect.
 */
import { getClientIp } from "../../_lib/request";
import { enforceRateLimit } from "../../_lib/rate-limit";
import { logError } from "../../_lib/logging";
import { submitMembershipForm, MembershipFormValidationError } from "../../_lib/services/membership-form-submission";

const ALLOWED_ORIGINS = new Set([
  "https://pkic.org",
  "https://www.pkic.org",
  // Local dev — Hugo serves the form pages on 1313, this worker on 8788.
  "http://localhost:8788",
  "http://localhost:1313",
]);

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "https:" && /^[a-z0-9-]+\.pkic\.pages\.dev$/.test(hostname);
  } catch {
    return false;
  }
}

function redirectWithStatus(refererUrl: URL, status: "success" | "error"): Response {
  const target = new URL(refererUrl);
  target.searchParams.set("status", status);
  return Response.redirect(target.toString(), 302);
}

export async function onRequestPost(c: any): Promise<Response> {
  const request: Request = c.req.raw;

  const refererHeader = request.headers.get("referer");
  let refererUrl: URL;
  try {
    refererUrl = new URL(refererHeader ?? "");
  } catch {
    return new Response("Invalid request", { status: 400 });
  }
  if (!isAllowedOrigin(refererUrl.origin)) {
    return new Response("Invalid request", { status: 400 });
  }

  try {
    await enforceRateLimit({
      binding: c.env.IP_RATE_LIMITER,
      namespace: "membership-form:ip",
      key: getClientIp(request),
    });
  } catch {
    return redirectWithStatus(refererUrl, "error");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return redirectWithStatus(refererUrl, "error");
  }

  try {
    const formData = await request.formData();
    await submitMembershipForm(formData, c.env);
    return redirectWithStatus(refererUrl, "success");
  } catch (error) {
    if (!(error instanceof MembershipFormValidationError)) {
      logError("MEMBERSHIP_FORM_SUBMIT_FAILED", { error: error instanceof Error ? error.message : String(error) });
    }
    return redirectWithStatus(refererUrl, "error");
  }
}
