import type { SiteSidebarTree } from "../../shared/site-content";
import { IconChevron } from "../ui/MediaIcons";

type Versions = NonNullable<SiteSidebarTree["versions"]>;
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

function VersionGroup({ label, items, minor = false }: { label: string; items: Version[]; minor?: boolean }) {
  const minors = [...new Set(items.map((item) => item.version.split(".").slice(0, 2).join(".")))];
  return (
    <details class="wg-sidebar-group" open={items.some((item) => item.current)}>
      <summary class="wg-sidebar-summary">
        <span class="wg-sidebar-link">{label}</span>
        <span class="wg-sidebar-chevron">
          <IconChevron pointing="right" width="14" height="14" />
        </span>
      </summary>
      <div class="wg-version-children">
        {minor
          ? minors.map((version) => (
              <VersionGroup
                key={version}
                label={`${version}.x`}
                items={items.filter((item) => item.version.startsWith(`${version}.`))}
              />
            ))
          : items.map((item) => <VersionLink key={item.id} item={item} />)}
      </div>
    </details>
  );
}

/** Every model tree uses this bounded major/minor/patch hierarchy, including sidebars. */
export function WorkingGroupVersions({ versions }: { versions: Versions }) {
  const releases = versions.items
    .filter((item) => item.status === "released")
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const majors = [...new Set(releases.map((item) => item.version.split(".")[0]))];
  const drafts = versions.items.filter((item) => item.status === "draft");
  return (
    <div class="wg-version-switcher" role="group" aria-label={versions.label}>
      <p class="wg-version-eyebrow">Switch version</p>
      <div class="wg-version-list">
        {majors.map((major) => (
          <VersionGroup
            key={major}
            label={`${major}.x`}
            items={releases.filter((item) => item.version.startsWith(`${major}.`))}
            minor
          />
        ))}
        {drafts.length ? <VersionGroup label="Drafts" items={drafts} /> : null}
      </div>
    </div>
  );
}
