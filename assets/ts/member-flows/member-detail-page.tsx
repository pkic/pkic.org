/**
 * Member profile detail page. Replaces
 * the build-time member page templates, which rendered one static page per
 * YAML file. Organization
 * ids are UUIDs now, not slugs, and D1 (not a build-time YAML scan) is the
 * source of truth — so instead of one generated Hugo page per member, this is
 * a single shell page (content/members/profile.md) that reads `?id=` from the
 * query string and fetches GET /api/v1/members/:id client-side, mirroring the
 * `?id=&token=` query-string pattern application-status-page.tsx already uses
 * for the same "no per-record static page" reason.
 *
 * The layout is the design system's: a measured column, a stack for vertical
 * rhythm, and a grid that reflows when its columns stop fitting — rather than
 * `col-lg-*`/`order-lg-*` pairs and an `mb-*` on every child. What is kept
 * from the legacy stylesheet is the logo's height; a missing logo or portrait
 * is the design-system `Avatar`, like every other initials stand-in.
 */
import { render } from "preact";
import { MemberDetailView } from "../site/MemberProfile";
import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { NotFoundPanel } from "../components/NotFoundPanel";
import {
  publicMemberDetailSchema,
  type PublicMemberDetail as MemberDetail,
} from "../../shared/schemas/members-directory";
// `pk-datalist` is a Content.css class, and component CSS ships in a lazy
// chunk rather than the entry stylesheet — a module that writes the class name
// has to import the sheet that defines it, or the list renders unstyled.
import "../ui/Content.css";

import "../site/member-directory.css";

const API_BASE_FALLBACK = "/api/v1";

/** `/members/<slug>` (functions/members/[slug].ts) serves this exact shell
 * page with no `?id=` query string — the org's slug is the last path
 * segment instead. Returns null for the shell's own canonical path
 * (`/members/profile/`) so a direct, id-less visit still falls through to
 * "not found" rather than trying to fetch `/api/v1/members/profile`. */
function slugFromPathname(pathname: string): string | null {
  const match = /^\/members\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  return match[1] === "profile" ? null : match[1];
}

export function MemberDetailPage({ apiBase, directoryHref }: { apiBase: string; directoryHref: string }) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? slugFromPathname(window.location.pathname);
    if (!id) {
      setNotFound(true);
      return;
    }
    getJson(`${apiBase}/members/${encodeURIComponent(id)}`, publicMemberDetailSchema)
      .then((data) => setMember(data))
      .catch((e) => {
        if ((e as { status?: number }).status === 404) setNotFound(true);
        else setError((e as Error).message);
      });
  }, [apiBase]);

  if (notFound) {
    return (
      <NotFoundPanel message="We couldn’t find that member." backHref={directoryHref} backLabel="Back to members" />
    );
  }
  if (error) return <ErrorAlert error={error} />;
  // Named, so the wait says what is loading rather than announcing a bare
  // "Loading…" on a page that is otherwise empty.
  if (!member) return <Spinner label="Loading member profile…" />;

  return <MemberDetailView member={member} directoryHref={directoryHref} />;
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-member-detail]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const directoryHref = root.dataset.directoryHref ?? "/members/";
  render(<MemberDetailPage apiBase={apiBase} directoryHref={directoryHref} />, root);
}

main();
