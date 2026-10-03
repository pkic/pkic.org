/**
 * Member directory listing. Replaces the Hugo-data-driven
 * A-Z grid (layouts/partials/members/listing.html, driven by hugo.Data.members
 * at build time) with a Preact component that fetches GET /api/v1/members.
 *
 * D1 is now the source of truth (Step 2 has run). Search, sorting, and
 * pagination are sent to the API and performed in D1; the browser only
 * groups the complete directory into presentation buckets.
 */
import { render } from "preact";
import { useState } from "preact/hooks";
import { DirectoryGrid, MemberCard } from "../site/MemberDirectory";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { publicMembersListResponseSchema } from "../../shared/schemas/members-directory";
import { useApiPage } from "../hooks/useApiPage";
import { useMemberDirectory } from "./use-member-directory";

import "../site/member-directory.css";

const API_BASE_FALLBACK = "/api/v1";
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
  const listing = useMemberDirectory(apiBase, group, search);
  const members = listing.data?.members;

  if (listing.error) return <ErrorAlert error={listing.error} />;
  if (!members || listing.loading || listing.loadingMore || listing.page?.hasMore) return <Spinner />;

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
