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
import { EmptyState } from "../components/EmptyState";
import { Pager } from "../components/Pager";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { memberProfileHref } from "../../shared/member-profile-url";
import { publicMembersListResponseSchema, type PublicMemberSummary } from "../../shared/schemas/members-directory";
import { useApiPage } from "../hooks/useApiPage";
import { monogramFrom } from "../shared/initials";

const API_BASE_FALLBACK = "/api/v1";
const DIGITS = new Set("0123456789".split(""));

export type DirectoryMember = PublicMemberSummary;

function letterBucket(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  if (DIGITS.has(c)) return "#";
  if (/^[A-Z]$/.test(c)) return c;
  return "…";
}

function MemberCard({ member }: { member: DirectoryMember }) {
  // Decided in `assets/shared/member-profile-url.ts`, not here: the wall, the
  // charter roll and this grid all link to the same page and used to answer
  // "where is it?" three separate ways (#15).
  const href = memberProfileHref(member);
  const colorIdx = member.name.length % 6;

  return (
    <div class="member-card bento-card">
      <a class="pk-stretched" href={href} aria-label={member.name}></a>
      <div class="member-card-logo-wrap">
        {member.logoUrl ? (
          <img class="member-card-logo" src={member.logoUrl} alt={`${member.name} logo`} loading="lazy" />
        ) : (
          <div class={`member-card-initials initial-color-${colorIdx}`}>{monogramFrom(member.name)}</div>
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

function DirectoryGrid({ members, prefix }: { members: DirectoryMember[]; prefix: string }) {
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
    return (
      <EmptyState
        title="No members found."
        body="No member matches your search. Try a shorter term, or clear the search to see everyone."
      />
    );
  }

  return (
    <div class="members-layout">
      {/* When the rail appears is a property of the rail, so it lives with
          the rest of its shape in `_members-directory.scss` rather than as a
          responsive display class here. */}
      <nav class="members-az-sidebar" aria-label="Jump to letter">
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
                <MemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        )}
        {presentLetters.map((l) => (
          <section class="member-letter-group" id={`${prefix}-${l}`} key={l}>
            <h3 class="member-letter-heading">{l}</h3>
            <div class="members-grid">
              {buckets.get(l)!.map((m) => (
                <MemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        ))}
        {hasOther && (
          <section class="member-letter-group" id={`${prefix}-OTHER`}>
            <h3 class="member-letter-heading">Other</h3>
            <div class="members-grid">
              {buckets.get("…")!.map((m) => (
                <MemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The same roll, narrowed to one group and shown as a plain grid.
 *
 * A working group's page states who is in the room; it is not the members
 * directory, so it carries no search, no A-Z rail and no paging — it links to
 * the directory for that. It used to filter `data/members/*.yaml` on a
 * `workingGroups` field, which listed whoever was in a file (#8).
 */
export function GroupMemberGrid({ apiBase, workingGroup }: { apiBase: string; workingGroup: string }) {
  const listing = useApiPage(
    `${apiBase}/members`,
    { workingGroup, group: "organization", sort: "name" },
    publicMembersListResponseSchema,
    (data) => data.members,
  );
  const members = listing.data?.members;

  if (listing.error) return <ErrorAlert error={listing.error} />;
  if (!members) return <Spinner />;
  // Nothing rather than an empty-state box: the section around this already
  // says what it is, and a group with no members yet is a fact about the
  // group, not a failure the reader can act on.
  if (members.length === 0) return null;

  return (
    <div class="members-grid">
      {members.map((member) => (
        <MemberCard key={member.id} member={member} />
      ))}
    </div>
  );
}

export function MemberDirectory({
  apiBase,
  group,
  prefix,
  label,
}: {
  apiBase: string;
  group: "organization" | "independent";
  prefix: string;
  label: string;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const listing = useApiPage(
    `${apiBase}/members`,
    { group, sort: "name", ...(search ? { q: search } : {}) },
    publicMembersListResponseSchema,
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
    <div class="pk-section pk-stack">
      <div class="pk-container">
        {/*
         * `.pk` goes on the form and not on the page root: the form's
         * appearance is now the design system's, while the cards, the A-Z
         * rail and the letter headings are still styled by `assets/scss`, and
         * the base layer beats `legacy` — it would resize the letter headings
         * and recolor the rail. The layout utilities are unscoped, so the
         * page still gets its measure and rhythm from them.
         */}
        <form class="pk pk-stack pk-stack--snug members-search-bar" onSubmit={submitSearch}>
          <Field label={`Search ${label}`}>
            {(control) => (
              <TextInput
                {...control}
                type="search"
                placeholder={`Search ${label}…`}
                autocomplete="off"
                value={searchInput}
                onInput={(e) => setSearchInput((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>
          <div class="pk-cluster pk-cluster--end">
            <Button type="submit" variant="primary">
              Search
            </Button>
          </div>
        </form>
      </div>
      <div class="pk-container pk-container--wide">
        <DirectoryGrid members={members} prefix={prefix} />
        {listing.pagerProps && <Pager {...listing.pagerProps} />}
      </div>
    </div>
  );
}

function main(): void {
  for (const grid of document.querySelectorAll<HTMLElement>("[data-group-member-grid]")) {
    const workingGroup = grid.dataset.workingGroup ?? "";
    if (!workingGroup) continue;
    render(<GroupMemberGrid apiBase={grid.dataset.apiBase ?? API_BASE_FALLBACK} workingGroup={workingGroup} />, grid);
  }

  const root = document.querySelector<HTMLElement>("[data-member-directory]");
  if (!root) return;

  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const group = root.dataset.group === "independent" ? "independent" : "organization";
  const prefix = root.dataset.prefix ?? "m";
  const label = root.dataset.label ?? "members";

  render(<MemberDirectory apiBase={apiBase} group={group} prefix={prefix} label={label} />, root);
}

main();
