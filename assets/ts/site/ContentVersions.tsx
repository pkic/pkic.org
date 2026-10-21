import type { ContentVersionNavigation } from "../../shared/content-versions";

type Versions = ContentVersionNavigation;
type Version = Versions["items"][number];

function VersionLink({ item }: { item: Version }) {
  return (
    <a
      class={`wg-version-item${item.current ? " is-active" : ""}`}
      href={item.href}
      aria-current={item.current ? "page" : undefined}
    >
      <span class="wg-version-badge">{item.label}</span>
      {item.latest ? <span class="wg-version-hint">Latest release</span> : null}
      {item.fallback ? (
        <span
          class="wg-version-hint wg-version-hint--fallback"
          title="This page is unavailable in that version; open its overview"
        >
          Overview
        </span>
      ) : null}
    </a>
  );
}

/** Both model menus offer direct links; historical releases belong in Version History. */
export function ContentVersions({ versions }: { versions: Versions }) {
  const items = versions.items.filter((item) => item.latest || item.current || item.status === "draft");
  return (
    <div class="wg-version-switcher" role="group" aria-label={versions.label}>
      <p class="wg-version-eyebrow">Switch version</p>
      <div class="wg-version-list">
        {items.map((item) => (
          <VersionLink key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
