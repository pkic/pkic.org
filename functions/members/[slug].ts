/**
 * GET /members/:slug — clean-URL organization profile pages
 * (`/members/keyfactor` instead of `/members/profile/?id=<uuid>`).
 *
 * This project's Worker runs as a single Hono app in front of the static
 * Hugo build (`wrangler.jsonc`'s `run_worker_first` gates which paths reach
 * it at all — see functions/members/router.ts's mount and the config note
 * there). `/members/*` is added to that allowlist so a bare organization
 * slug reaches this handler instead of falling straight through to
 * Cloudflare's static-asset layer (which would 404 — no such file exists).
 *
 * Rather than redirecting to `/members/profile/?id=<slug>` (which would
 * change the URL the visitor sees, defeating the point of a clean URL),
 * this serves the exact same static profile shell HTML that
 * `/members/profile/` already serves, verbatim, at the `/members/<slug>`
 * path. `member-detail-page.tsx`'s client JS then resolves the org from
 * `location.pathname` when there's no `?id=` query string.
 */
import { first } from "../_lib/db/queries";
import { getStaticAssetsBinding } from "../_lib/static-assets";
import type { DatabaseLike, Env } from "../_lib/types";

// The two real static sub-paths under public/members/ — must never be
// shadowed by an organization-slug lookup even though they match this
// route's single-segment `/:slug` pattern.
const RESERVED_SLUGS = new Set(["profile", "independent"]);

/**
 * Registered as a single catch-all (`functions/members/router.ts`'s
 * `app.get("*", onRequestGet)`) rather than a `/:slug` route — a real org
 * slug is always exactly one path segment, but plenty of legitimate static
 * requests under `/members/` are NOT (the bare `/members`/`/members/`
 * directory page itself, `/members/independent/og-card.html`, etc.), and a
 * `/:slug`-shaped route has no way to match those, so they'd 404 out of
 * this Hono app instead of falling through to the static asset. Computing
 * everything from the raw pathname sidesteps that entirely.
 */
export async function onRequestGet(c: any): Promise<Response> {
  const pathname = new URL(c.req.raw.url).pathname;
  const rest = pathname.replace(/^\/members\/?/, "").replace(/\/$/, "");
  const binding = getStaticAssetsBinding(c.env as Env);
  const isCandidateSlug = rest.length > 0 && !rest.includes("/") && !rest.includes(".");

  // Anything that isn't a single bare path segment (no slash, no dot) is
  // either the bare directory page, a nested static path, or a file —
  // never a real org slug — so it passes straight through without a D1
  // round-trip.
  if (!binding || !isCandidateSlug || RESERVED_SLUGS.has(rest)) {
    return binding ? binding.fetch(c.req.raw) : fetch(c.req.raw);
  }

  const org = await first<{ id: string }>(c.env.DB as DatabaseLike, "SELECT id FROM organizations WHERE slug = ?", [
    rest,
  ]);
  if (!org) {
    return binding.fetch(c.req.raw);
  }

  const shellUrl = new URL("/members/profile/", c.req.raw.url);
  return binding.fetch(new Request(shellUrl, c.req.raw));
}
