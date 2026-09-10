/**
 * The member organizations participating in a group, named inline.
 *
 * This replaces `layouts/shortcodes/wgmembers.html`, which read the YAML
 * under `data/members/` at build time and so listed whoever was in a file
 * rather than whoever is in the group (#8). It reads the canonical members
 * roll narrowed to the group — one member per row however many people it
 * seats — so a charter page names the room from D1 and updates when the room
 * does, without a rebuild.
 *
 * Deliberately a sentence rather than a grid: it renders inside a table cell
 * on a charter page, where the existing markup is a comma-separated run of
 * links. The directory grid is a different surface with its own mount.
 */
import { render } from "preact";
import { memberProfileHref } from "../../shared/member-profile-url";
import { API_BASE_FALLBACK, useMemberRoll } from "./member-roll";

/**
 * How many names one charter row may carry.
 *
 * A sentence, not a directory: the roll is paginated, and a row that would
 * run to three hundred links is a page of its own — which the members
 * directory already is, and which the "View all members" link beside this
 * goes to.
 */
const MAX_NAMED = 100;

export function GroupMembersWidget({ apiBase, slug }: { apiBase: string; slug: string }) {
  // A charter page is readable without its member list, so a failed read
  // leaves the cell empty rather than an error inside a table row — which is
  // what the shared roll does with a refusal.
  const members = useMemberRoll(apiBase, { workingGroup: slug, limit: MAX_NAMED });

  if (members === null) return null;
  if (members.length === 0) return null;

  return (
    <>
      {members.map((member, index) => (
        <span key={member.id}>
          {index > 0 && ", "}
          {/* The member's page on this site, the same address the directory
              and the wall link to. This used to fall back to the
              organization's own website when there was no slug, so one row of
              a charter page left the site and the row beside it did not —
              three surfaces, three answers, which is #15 under the UUID. */}
          <a href={memberProfileHref(member)} title={member.name}>
            {member.name}
          </a>
        </span>
      ))}
    </>
  );
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-group-members]").forEach((root) => {
    const slug = root.dataset.groupSlug ?? "";
    if (!slug) return;
    render(<GroupMembersWidget apiBase={root.dataset.apiBase ?? API_BASE_FALLBACK} slug={slug} />, root);
  });
}

main();
