/**
 * The member logo wall behind a social card.
 *
 * `all.og-card.html` built this at Hugo build time: it walked the member
 * section's pages (or `hugo.Data.members` filtered on a `workingGroups`
 * field) and resolved each logo out of `assets/images/members/`, so a card
 * showed whoever was in a YAML file rather than whoever is a member (#8).
 *
 * It reads the same canonical roll the charter sentence reads, in the other
 * shape. Fetching works here because the card is screenshotted by Cloudflare
 * Browser Rendering with `waitUntil: networkidle0`
 * (`functions/og/[...path].ts`), which waits for this read and the logo loads
 * it starts — the same reason the chair panel beside it is a mount.
 */
import { render } from "preact";
import type { PublicMemberSummary } from "../../shared/schemas/members-directory";
import { API_BASE_FALLBACK, useMemberRoll } from "./member-roll";

/**
 * How many logos a card may carry. The wall is a background texture, not a
 * directory: past this the tiles are too small to read as logos at all, and
 * the card is a fixed canvas.
 */
const MAX_LOGOS = 120;

/**
 * A deterministic shuffle, seeded by the group being shown.
 *
 * The old template called Hugo's `shuffle`, so every rebuild reordered the
 * wall. A social card is cached by URL and compared against its previous
 * capture, so an order that changes on every render makes every card look
 * changed. Seeding on the wall's own subject keeps the arrangement varied
 * between cards and stable for each one.
 */
function arrange(members: readonly PublicMemberSummary[], seed: string): readonly PublicMemberSummary[] {
  let state = [...seed].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 2147483647, 7) || 7;
  const shuffled = [...members];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (state * 48271) % 2147483647;
    const swap = state % (index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

export function MemberLogoWall({
  apiBase,
  workingGroup,
  containerClass,
  logoClass,
}: {
  apiBase: string;
  workingGroup?: string;
  containerClass: string;
  logoClass: string;
}) {
  const members = useMemberRoll(apiBase, { workingGroup, limit: MAX_LOGOS });
  if (!members) return null;

  // A logo wall is made of logos: a member without one is left out rather
  // than shown as its name or as a gap in the grid.
  const withLogos = members.filter((member) => member.logoUrl);
  if (withLogos.length === 0) return null;

  return (
    <div class={containerClass} aria-hidden="true">
      {arrange(withLogos, workingGroup ?? "members").map((member) => (
        <div class={logoClass} key={member.id}>
          <img src={member.logoUrl ?? ""} alt="" />
        </div>
      ))}
    </div>
  );
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-member-logo-wall]").forEach((root) => {
    render(
      <MemberLogoWall
        apiBase={root.dataset.apiBase ?? API_BASE_FALLBACK}
        workingGroup={root.dataset.workingGroup || undefined}
        containerClass={root.dataset.containerClass ?? "og-member-wall-bg"}
        logoClass={root.dataset.logoClass ?? "og-member-logo"}
      />,
      root,
    );
  });
}

main();
