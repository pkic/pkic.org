/**
 * POST /api/v1/forms
 *
 * Receives form submissions (application/x-www-form-urlencoded, since
 * neither template sets enctype="multipart/form-data" — multipart is also
 * accepted in case that ever changes) from the join-membership form
 * (layouts/shortcodes/joinform.html) and the sponsor-interest form
 * (layouts/shortcodes/sponsorform.html), and files each one as a GitHub
 * issue in pkic/members.
 *
 * These are plain `<form method="POST">` submissions, not fetch() calls —
 * the browser navigates on submit, so the response here is always a
 * redirect back to the referring page with ?status=success or
 * ?status=error, never a JSON error body. The Referer (falling back to
 * Origin if Referer was stripped) must match APP_BASE_URL — the same value
 * every other endpoint treats as this deployment's own canonical origin
 * (production, preview, and branch-preview deploys each get their own
 * APP_BASE_URL; local dev falls back to the request's own origin, see
 * resolveAppBaseUrl) — before it's ever used as a redirect target, so this
 * can't be abused as an open redirect, and requests with neither a
 * recognized Referer nor Origin are rejected outright.
 */
import { getClientIp } from "../../_lib/request";
import { enforceRateLimit } from "../../_lib/rate-limit";
import { isAppError } from "../../_lib/errors";
import { logError } from "../../_lib/logging";
import { resolveAppBaseUrl } from "../../_lib/config";
import { LEGACY_FORM_MAX_BYTES, readBoundedFormData } from "../../_lib/http-body";
import { submitMembershipForm, MembershipFormValidationError } from "../../_lib/services/membership-form-submission";

function redirectWithStatus(refererUrl: URL, status: "success" | "error"): Response {
  const target = new URL(refererUrl);
  target.searchParams.set("status", status);
  return Response.redirect(target.toString(), 302);
}

export async function onRequestPost(c: any): Promise<Response> {
  const request: Request = c.req.raw;

  const refererHeader = request.headers.get("referer");
  const originHeader = request.headers.get("origin");

  let refererUrl: URL | null = null;
  if (refererHeader) {
    try {
      refererUrl = new URL(refererHeader);
    } catch {
      refererUrl = null;
    }
  }

  // Referer may be missing — stripped by a privacy-focused browser/extension
  // or a strict Referrer-Policy — even for a legitimate same-site
  // submission. Origin isn't affected by any of that (browsers always set it
  // on POST requests and it can't be suppressed by page content), so it's a
  // safe fallback for validation. It is never used as the redirect target.
  let trustedOrigin: string;
  try {
    trustedOrigin = resolveAppBaseUrl(c.env, request);
  } catch (error) {
    logError("MEMBERSHIP_FORM_APP_BASE_URL_MISSING", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Invalid request", { status: 400 });
  }
  const candidateOrigin = refererUrl?.origin ?? originHeader ?? "";
  if (!candidateOrigin || candidateOrigin !== trustedOrigin) {
    return new Response("Invalid request", { status: 400 });
  }

  // Referer doubles as the redirect target. If it was missing/unparsable
  // but Origin validated fine, redirect to that origin's site root instead.
  const redirectUrl = refererUrl ?? new URL("/", candidateOrigin);

  try {
    await enforceRateLimit({
      binding: c.env.IP_RATE_LIMITER,
      namespace: "membership-form:ip",
      key: getClientIp(request),
    });
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") {
      return redirectWithStatus(redirectUrl, "error");
    }
    logError("MEMBERSHIP_FORM_RATE_LIMIT_UNAVAILABLE", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (new URL(trustedOrigin).hostname !== "localhost") {
      // Binding not configured or the rate-limiting service itself is
      // unavailable — fail closed outside local dev rather than allow
      // unbounded GitHub issue creation.
      return redirectWithStatus(redirectUrl, "error");
    }
    // Local dev: the binding usually isn't configured — don't block testing.
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isFormEncoded =
    contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded");
  if (!isFormEncoded) {
    return redirectWithStatus(redirectUrl, "error");
  }

  try {
    const formData = await readBoundedFormData(request, LEGACY_FORM_MAX_BYTES);
    await submitMembershipForm(formData, c.env);
    return redirectWithStatus(redirectUrl, "success");
  } catch (error) {
    if (!(error instanceof MembershipFormValidationError)) {
      logError("MEMBERSHIP_FORM_SUBMIT_FAILED", { error: error instanceof Error ? error.message : String(error) });
    }
    return redirectWithStatus(redirectUrl, "error");
  }
}
