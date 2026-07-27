/**
 * Member profile detail page (PRD §1.6 Part B). Replaces
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

const API_BASE_FALLBACK = "/api/v1";

interface Representative {
  name: string;
  jobTitle: string | null;
  bio: string | null;
  linkedin: string | null;
  photoUrl: string | null;
}

interface MemberDetail {
  id: string;
  name: string;
  memberType: string;
  tier: string | null;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logoUrl: string | null;
  memberSince: string;
  content: string | null;
  blogUrl: string | null;
  blogFeedUrl: string | null;
  pressUrl: string | null;
  pressFeedUrl: string | null;
  careersUrl: string | null;
  social: {
    x: string | null;
    linkedin: string | null;
    facebook: string | null;
    instagram: string | null;
    youtube: string | null;
  };
  representatives: Representative[];
  jobTitle: string | null;
  linkedin: string | null;
}

function LinkedInIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854V1.146zm4.943 12.248V6.169H2.542v7.225h2.401zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248-.822 0-1.359.54-1.359 1.248 0 .694.521 1.248 1.327 1.248h.016zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016a5.54 5.54 0 0 1 .016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225h2.4z" />
    </svg>
  );
}

function SocialLinks({ social, linkedin }: { social?: MemberDetail["social"]; linkedin?: string | null }) {
  const links = linkedin ?? social?.linkedin;
  if (!links) return null;
  return (
    <a href={links} target="_blank" rel="noopener" class="px-1" title="LinkedIn">
      <LinkedInIcon />
    </a>
  );
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
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
          <div
            class={`standalone-initials initial-color-${rep.name.length % 6}`}
            style="width:100px;height:100px;font-size:1.5rem;"
          >
            {initialsFor(rep.name)}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberDetailView({ member, directoryHref }: { member: MemberDetail; directoryHref: string }) {
  const colorIdx = member.name.length % 6;

  return (
    <div>
      <section class="py-4 text-center container">
        <div class="row py-lg-2">
          <div class="col-10 mx-auto">
            {member.logoUrl ? (
              <img style="height:150px;max-width:60%" class="py-3" alt={member.name} src={member.logoUrl} />
            ) : (
              <div
                class={`standalone-initials initial-color-${colorIdx} mx-auto`}
                style="width:120px;height:120px;font-size:2rem;"
              >
                {initialsFor(member.name)}
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
                <SocialLinks social={member.social} linkedin={member.linkedin} />
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
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      setNotFound(true);
      return;
    }
    getJson<MemberDetail>(`${apiBase}/members/${encodeURIComponent(id)}`)
      .then(setMember)
      .catch((e) => {
        if ((e as { status?: number }).status === 404) setNotFound(true);
        else setError((e as Error).message);
      });
  }, [apiBase]);

  if (notFound) {
    return (
      <div class="container py-5 text-center">
        <p class="lead">We couldn&rsquo;t find that member.</p>
        <a href={directoryHref}>&larr; Back to members</a>
      </div>
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
