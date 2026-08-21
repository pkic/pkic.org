/**
 * Member directory listing. Replaces the Hugo-data-driven
 * A-Z grid (layouts/partials/members/listing.html, driven by hugo.Data.members
 * at build time) with a Preact component that fetches GET /api/v1/members.
 *
 * D1 is now the source of truth (Step 2 has run). Search, sorting, and
 * pagination are sent to the API and performed in D1; the browser only
 * groups the current page into presentation buckets.
 */
import { render } from "preact";
import { useMemo, useState } from "preact/hooks";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { Pager } from "../components/Pager";
import { membersListResponseSchema, type PublicMemberSummary } from "../../shared/schemas/members-directory";
import { useApiPage } from "../hooks/useApiPage";
import { memberInitials } from "../shared/member-display";

const API_BASE_FALLBACK = "/api/v1";
const DIGITS = new Set("0123456789".split(""));

export type DirectoryMember = PublicMemberSummary;

function letterBucket(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  if (DIGITS.has(c)) return "#";
  if (/^[A-Z]$/.test(c)) return c;
  return "…";
}

function MemberCard({ member, detailBase }: { member: DirectoryMember; detailBase: string }) {
  // Org-tied members get a clean URL (functions/members/[slug].ts); org-less
  // individuals have no organizations row to hold a slug on, so they keep
  // the query-string form.
  const href = member.slug
    ? `/members/${encodeURIComponent(member.slug)}/`
    : `${detailBase}?id=${encodeURIComponent(member.id)}`;
  const colorIdx = member.name.length % 6;

  return (
    <div class="member-card bento-card">
      <a class="stretched-link" href={href} aria-label={member.name}></a>
      <div class="member-card-logo-wrap">
        {member.logoUrl ? (
          <img class="member-card-logo" src={member.logoUrl} alt={`${member.name} logo`} loading="lazy" />
        ) : (
          <div class={`member-card-initials initial-color-${colorIdx}`}>{memberInitials(member.name)}</div>
        )}
      </div>
      <div class="member-card-name">{member.name}</div>
      {member.slogan && <div class="member-card-slogan">{member.slogan}</div>}
      {member.description && (
        <p class="member-card-description">
          {member.description.length > 160 ? `${member.description.slice(0, 160).trimEnd()}…` : member.description}
        </p>
      )}
    </div>
  );
}

function DirectoryGrid({
  members,
  prefix,
  detailBase,
}: {
  members: DirectoryMember[];
  prefix: string;
  detailBase: string;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, DirectoryMember[]>();
    for (const m of members) {
      const key = letterBucket(m.name);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [members]);

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const hasNum = buckets.has("#");
  const hasOther = buckets.has("…");
  const presentLetters = letters.filter((l) => buckets.has(l));

  if (members.length === 0) {
    return <p class="text-muted fst-italic text-center mt-3">No members found matching your search.</p>;
  }

  return (
    <div class="members-layout">
      <nav class="members-az-sidebar d-none d-lg-flex flex-column" aria-label="Jump to letter">
        {hasNum && (
          <a class="az-sidebar-link" href={`#${prefix}-NUM`}>
            #
          </a>
        )}
        {letters.map((l) => (
          <a key={l} class={`az-sidebar-link${buckets.has(l) ? "" : " is-empty"}`} href={`#${prefix}-${l}`}>
            {l}
          </a>
        ))}
        {hasOther && (
          <a class="az-sidebar-link" href={`#${prefix}-OTHER`}>
            …
          </a>
        )}
      </nav>
      <div class="members-content">
        {hasNum && (
          <section class="member-letter-group" id={`${prefix}-NUM`}>
            <h3 class="member-letter-heading">0 – 9</h3>
            <div class="members-grid">
              {buckets.get("#")!.map((m) => (
                <MemberCard key={m.id} member={m} detailBase={detailBase} />
              ))}
            </div>
          </section>
        )}
        {presentLetters.map((l) => (
          <section class="member-letter-group" id={`${prefix}-${l}`} key={l}>
            <h3 class="member-letter-heading">{l}</h3>
            <div class="members-grid">
              {buckets.get(l)!.map((m) => (
                <MemberCard key={m.id} member={m} detailBase={detailBase} />
              ))}
            </div>
          </section>
        ))}
        {hasOther && (
          <section class="member-letter-group" id={`${prefix}-OTHER`}>
            <h3 class="member-letter-heading">Other</h3>
            <div class="members-grid">
              {buckets.get("…")!.map((m) => (
                <MemberCard key={m.id} member={m} detailBase={detailBase} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function MemberDirectory({
  apiBase,
  group,
  prefix,
  label,
  detailBase,
}: {
  apiBase: string;
  group: "organization" | "independent";
  prefix: string;
  label: string;
  detailBase: string;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const listing = useApiPage(
    `${apiBase}/members`,
    { group, sort: "name", ...(search ? { q: search } : {}) },
    membersListResponseSchema,
    (data) => data.members,
  );
  const members = listing.data?.members;

  if (listing.error) return <ErrorAlert error={listing.error} />;
  if (!members) return <Spinner />;

  function submitSearch(event: SubmitEvent): void {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  return (
    <>
      <div class="py-3">
        <div class="container">
          <form class="members-search-bar mx-auto" onSubmit={submitSearch}>
            <div class="input-group input-group-lg">
              <span class="input-group-text bg-white border-end-0 text-muted">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.868-3.834zm-5.242 1.406a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
                </svg>
              </span>
              <input
                type="search"
                class="form-control border-start-0 ps-0"
                placeholder={`Search ${label}…`}
                aria-label={`Search ${label}`}
                autocomplete="off"
                value={searchInput}
                onInput={(e) => setSearchInput((e.target as HTMLInputElement).value)}
              />
              <button class="btn btn-primary" type="submit">
                Search
              </button>
            </div>
          </form>
        </div>
      </div>
      <div class="container-fluid px-2 px-md-4 pb-5">
        <DirectoryGrid members={members} prefix={prefix} detailBase={detailBase} />
        {listing.pagerProps && <Pager {...listing.pagerProps} />}
      </div>
    </>
  );
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-member-directory]");
  if (!root) return;

  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const group = root.dataset.group === "independent" ? "independent" : "organization";
  const prefix = root.dataset.prefix ?? "m";
  const label = root.dataset.label ?? "members";
  const detailBase = root.dataset.detailBase ?? "/members/profile/";

  render(
    <MemberDirectory apiBase={apiBase} group={group} prefix={prefix} label={label} detailBase={detailBase} />,
    root,
  );
}

main();
