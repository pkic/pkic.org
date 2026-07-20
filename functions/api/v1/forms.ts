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
import { resolveAppBaseUrl } from "../../_lib/config";
import { submitMembershipForm, MembershipFormValidationError } from "../../_lib/services/membership-form-submission";
import type { Env } from "../../_lib/types";

const ALLOWED_ORIGINS = new Set([
  "https://pkic.org",
  "https://www.pkic.org",
  // Default Cloudflare Pages production domain (apex — preview subdomains
  // are matched separately below).
  "https://pkic.pages.dev",
]);

// Local dev — Hugo serves the form pages on 1313, this worker on 8788.
// Only trusted when APP_BASE_URL (or the request itself, absent an
// APP_BASE_URL override) resolves to localhost, so a forged
// "http://localhost:8788" Origin/Referer can't bypass this check against the
// production worker, where APP_BASE_URL is always pinned to a real domain.
const LOCAL_DEV_ORIGINS = new Set(["http://localhost:8788", "http://localhost:1313"]);

function isLocalDevRequest(env: Pick<Env, "APP_BASE_URL">, request: Request): boolean {
  try {
    return new URL(resolveAppBaseUrl(env, request)).hostname === "localhost";
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string, allowLocalDev: boolean): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (allowLocalDev && LOCAL_DEV_ORIGINS.has(origin)) return true;
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
  const allowLocalDev = isLocalDevRequest(c.env, request);
  const candidateOrigin = refererUrl?.origin ?? originHeader ?? "";
  if (!candidateOrigin || !isAllowedOrigin(candidateOrigin, allowLocalDev)) {
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
    if (!allowLocalDev) {
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
