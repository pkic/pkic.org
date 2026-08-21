/**
 * Member profile detail page. Replaces
 * layouts/members/single.html (and independent.html), which rendered one
 * static page per YAML file via content/members/_content.gotmpl. Organization
 * ids are UUIDs now, not slugs, and D1 (not a build-time YAML scan) is the
 * source of truth — so instead of one generated Hugo page per member, this is
 * a single shell page (content/members/profile.md) that reads `?id=` from the
 * query string and fetches GET /api/v1/members/:id client-side, mirroring the
 * `?id=&token=` query-string pattern application-status-page.tsx already uses
 * for the same "no per-record static page" reason.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { Markdown } from "../components/Markdown";
import { NotFoundPanel } from "../components/NotFoundPanel";
import { memberInitials } from "../shared/member-display";
import { findLinkedinUrl } from "../../shared/schemas/links";
import {
  publicMemberDetailSchema,
  type PublicMemberDetail as MemberDetail,
} from "../../shared/schemas/members-directory";

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

type Representative = MemberDetail["representatives"][number];

function LinkedInIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854V1.146zm4.943 12.248V6.169H2.542v7.225h2.401zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248-.822 0-1.359.54-1.359 1.248 0 .694.521 1.248 1.327 1.248h.016zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016a5.54 5.54 0 0 1 .016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225h2.4z" />
    </svg>
  );
}

function SocialLinks({ linkedin }: { linkedin?: string | null }) {
  if (!linkedin) return null;
  return (
    <a href={linkedin} target="_blank" rel="noopener" class="px-1" title="LinkedIn">
      <LinkedInIcon />
    </a>
  );
}

const LINK_DOMAIN_LABELS: Record<string, string> = {
  "x.com": "X",
  "twitter.com": "X",
  "facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "youtube.com": "YouTube",
};

function detectLinkLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return LINK_DOMAIN_LABELS[hostname] ?? hostname;
  } catch {
    return url;
  }
}

/** Renders every org link that isn't the LinkedIn one already shown as the heading icon. */
function OtherLinks({ links, linkedin }: { links: string[]; linkedin: string | null }) {
  const others = links.filter((url) => url !== linkedin);
  if (others.length === 0) return null;
  return (
    <>
      {others.map((url) => (
        <span key={url}>
          <strong>{detectLinkLabel(url)}:</strong>{" "}
          <a href={url} target="_blank" rel="noopener">
            {url}
          </a>
          <br />
        </span>
      ))}
    </>
  );
}

function RepresentativeCard({ rep }: { rep: Representative }) {
  return (
    <div class="row mb-5">
      <div class="col-lg-9 order-lg-2">
        <h2 class="featurette-heading">
          {rep.name} <SocialLinks linkedin={rep.linkedin} />
        </h2>
        {rep.jobTitle && <h5>{rep.jobTitle}</h5>}
        {rep.bio && <Markdown markdown={rep.bio} />}
      </div>
      <div class="col-lg-3 order-lg-1">
        {rep.photoUrl ? (
          <img class="img-thumbnail" alt={rep.name} title={rep.name} src={rep.photoUrl} />
        ) : (
          <div class={`standalone-initials standalone-initials--representative initial-color-${rep.name.length % 6}`}>
            {memberInitials(rep.name)}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberDetailView({ member, directoryHref }: { member: MemberDetail; directoryHref: string }) {
  const colorIdx = member.name.length % 6;
  // member.linkedin is already resolved server-side for org-less individuals;
  // for organizations it's derived from the generic links list here.
  const linkedin = member.linkedin ?? findLinkedinUrl(member.links);

  return (
    <div>
      <section class="py-4 text-center container">
        <div class="row py-lg-2">
          <div class="col-10 mx-auto">
            {member.logoUrl ? (
              <img class="member-profile-logo py-3" alt={member.name} src={member.logoUrl} />
            ) : (
              <div class={`standalone-initials standalone-initials--hero initial-color-${colorIdx} mx-auto`}>
                {memberInitials(member.name)}
              </div>
            )}
            <h1 class="fw-light">
              <strong>{member.name}</strong> is a member of the PKI Consortium
            </h1>
            {member.jobTitle && <h5 class="text-muted">{member.jobTitle}</h5>}
            {member.slogan && <p class="lead text-muted">{member.slogan}</p>}
            {member.description && <p class="lead text-muted">{member.description}</p>}
          </div>
        </div>
      </section>

      <div class="py-2 bg-light"></div>

      <div class="py-5">
        <div class="container">
          <div class="row">
            <div class="col-lg-8 order-lg-1">{member.content && <Markdown markdown={member.content} />}</div>
            <div id="sidebar" class="col-lg-4 order-lg-2">
              <div class="text-end">
                <SocialLinks linkedin={linkedin} />
              </div>
              <small>
                <strong>Member since:</strong>{" "}
                {new Date(member.memberSince).toLocaleDateString(undefined, { year: "numeric", month: "long" })}
                <br />
                {member.website && (
                  <>
                    <strong>Website:</strong>{" "}
                    <a href={member.website} target="_blank" rel="noopener">
                      {member.website}
                    </a>
                    <br />
                  </>
                )}
                {member.pressUrl && (
                  <>
                    <strong>Press:</strong>{" "}
                    <a href={member.pressUrl} target="_blank" rel="noopener">
                      {member.pressUrl}
                    </a>
                    <br />
                  </>
                )}
                {member.careersUrl && (
                  <>
                    <strong>Careers:</strong>{" "}
                    <a href={member.careersUrl} target="_blank" rel="noopener">
                      {member.careersUrl}
                    </a>
                    <br />
                  </>
                )}
                {member.blogUrl && (
                  <>
                    <strong>Blog:</strong>{" "}
                    <a href={member.blogUrl} target="_blank" rel="noopener">
                      {member.blogUrl}
                    </a>
                    <br />
                  </>
                )}
                <OtherLinks links={member.links} linkedin={linkedin} />
              </small>
            </div>
          </div>
        </div>
      </div>

      {member.representatives.length > 0 && (
        <div class="py-5 bg-light">
          <div class="container">
            {member.representatives.map((rep) => (
              <RepresentativeCard key={rep.name} rep={rep} />
            ))}
          </div>
        </div>
      )}

      <div class="container py-4">
        <a href={directoryHref}>&larr; Back to members</a>
      </div>
    </div>
  );
}

function MemberDetailPage({ apiBase, directoryHref }: { apiBase: string; directoryHref: string }) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? slugFromPathname(window.location.pathname);
    if (!id) {
      setNotFound(true);
      return;
    }
    getJson<unknown>(`${apiBase}/members/${encodeURIComponent(id)}`)
      .then((data) => setMember(publicMemberDetailSchema.parse(data)))
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
  if (!member) return <Spinner />;

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
