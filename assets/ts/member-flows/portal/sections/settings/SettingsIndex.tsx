/**
 * The Settings section's own root page.
 *
 * What used to sit at this address was a hub whose tab strip chose which
 * settings page to draw inside it. The strip has gone: with each page listed
 * under Settings in the sidebar, a second strip repeating the same list was a
 * second navigation for one set of destinations, and it was the reason those
 * pages had no heading and no address of their own (#40).
 *
 * An index is not the strip in another shape. It is a destination — the same
 * relationship /groups has to the groups the sidebar lists under it — and it
 * can say what each page is for, which a strip of one-word tabs cannot.
 */
import { Link } from "wouter";

import type { PortalNavItem } from "../../shell/portal-navigation";
import { EmptyState } from "../../../../components/EmptyState";
import { PageHeader } from "../../../../ui/PageHeader";

export function SettingsIndex({ pages }: { pages: readonly PortalNavItem[] }) {
  return (
    <div class="pk pk-stack">
      <PageHeader
        title="Settings"
        description="How membership, moderation, mail and access are configured for the whole consortium."
      />
      {pages.length === 0 ? (
        // A permission-shaped dead end is still an empty state: it names what
        // is absent inside a `role="status"` region rather than leaving a
        // muted line that assistive technology announces as nothing at all.
        <EmptyState title="No settings permissions are assigned to this account." />
      ) : (
        <ul class="pk-stack pk-stack--snug" aria-label="Settings pages">
          {pages.map((page) => (
            <li key={page.path} class="pk-stack pk-stack--tight">
              <Link href={page.path} class="pk-strong">
                {page.label}
              </Link>
              {page.description && <p class="pk-small">{page.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
