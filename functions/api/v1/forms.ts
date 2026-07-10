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
 * Origin if Referer was stripped) is validated against ALLOWED_ORIGINS
 * before it's ever used as a redirect target, so this can't be abused as
 * an open redirect, and requests with neither a recognized Referer nor
 * Origin are rejected outright.
 */
import { getClientIp } from "../../_lib/request";
import { enforceRateLimit } from "../../_lib/rate-limit";
import { isAppError } from "../../_lib/errors";
import { logError } from "../../_lib/logging";
import { submitMembershipForm, MembershipFormValidationError } from "../../_lib/services/membership-form-submission";

const ALLOWED_ORIGINS = new Set([
  "https://pkic.org",
  "https://www.pkic.org",
  // Default Cloudflare Pages production domain (apex — preview subdomains
  // are matched separately below).
  "https://pkic.pages.dev",
  // Local dev — Hugo serves the form pages on 1313, this worker on 8788.
  "http://localhost:8788",
  "http://localhost:1313",
]);

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:") return false;
    // *.pkic.pages.dev — Cloudflare Pages preview deploys.
    // *.pkic.workers.dev — Cloudflare Workers preview/dev URLs (this project
    // deploys as a Worker with workers_dev/preview_urls enabled, so every
    // test-branch deploy gets a URL on this domain, e.g.
    // 8f547e2a-pkic-org.pkic.workers.dev).
    return /^[a-z0-9-]+\.pkic\.pages\.dev$/.test(hostname) || /^[a-z0-9-]+\.pkic\.workers\.dev$/.test(hostname);
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
  const candidateOrigin = refererUrl?.origin ?? originHeader ?? "";
  if (!candidateOrigin || !isAllowedOrigin(candidateOrigin)) {
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
    // Binding not configured (e.g. local dev) or the rate-limiting service
    // itself is unavailable — don't let that block a legitimate submission.
    logError("MEMBERSHIP_FORM_RATE_LIMIT_UNAVAILABLE", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isFormEncoded =
    contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded");
  if (!isFormEncoded) {
    return redirectWithStatus(redirectUrl, "error");
  }

  try {
    const formData = await request.formData();
    await submitMembershipForm(formData, c.env);
    return redirectWithStatus(redirectUrl, "success");
  } catch (error) {
    if (!(error instanceof MembershipFormValidationError)) {
      logError("MEMBERSHIP_FORM_SUBMIT_FAILED", { error: error instanceof Error ? error.message : String(error) });
    }
    return redirectWithStatus(redirectUrl, "error");
  }
}
