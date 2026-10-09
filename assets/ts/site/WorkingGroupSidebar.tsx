import type { SiteSidebarNode, SiteSidebarTree } from "../../shared/site-content";
import { IconChevron } from "../ui/MediaIcons";

/**
 * The section tree a working group's deliverables carry.
 *
 * It renders in two places from the same data: behind the section nav's
 * chevron, and as the sticky aside on pages that ask for a side menu. The
 * class names and the `details`/`summary` shape are the published site's, so
 * `global-ui.js` keeps driving the disclosures and the collapse button.
 */
/**
 * One row, at the depth it sits.
 *
 * Depth decides the shape rather than a separate component per level: the
 * first two levels open into a disclosure when they have children, the third
 * is always a plain link, and only a summary's own link carries
 * `wg-sidebar-link`.
 */
function SidebarNode({ depth, node }: { depth: number; node: SiteSidebarNode }) {
  if (!node.children?.length) {
    const className = [depth === 1 ? "wg-sidebar-link" : "", node.current ? "is-active" : ""].filter(Boolean).join(" ");
    return (
      <a class={className} href={node.href}>
        {node.label}
      </a>
    );
  }
  return (
    <details class={`wg-sidebar-group${depth > 1 ? " wg-sidebar-nested" : ""}`} open={node.open}>
      <summary class="wg-sidebar-summary">
        <a class={`wg-sidebar-link${node.current ? " is-active" : ""}`} href={node.href}>
          {node.label}
        </a>
        <span class="wg-sidebar-chevron">
          <IconChevron pointing="right" width="14" height="14" />
        </span>
      </summary>
      <ul class={`wg-sidebar-children${depth > 1 ? " wg-sidebar-level3" : ""}`}>
        {node.children.map((child) => (
          <li key={child.href}>
            <SidebarNode depth={depth + 1} node={child} />
          </li>
        ))}
      </ul>
    </details>
  );
}

export function WorkingGroupSidebarTree({ tree }: { tree: SiteSidebarTree }) {
  return (
    <>
      <a class={`wg-sidebar-root${tree.root.current ? " is-active" : ""}`} href={tree.root.href}>
        {tree.root.label}
      </a>
      {tree.promoted?.length ? (
        <ul class="wg-sidebar-children wg-sidebar-promoted">
          {tree.promoted.map((node) => (
            <li key={node.href}>
              <SidebarNode depth={2} node={node} />
            </li>
          ))}
        </ul>
      ) : null}
      <ul class="wg-sidebar-list">
        {tree.sections.map((node) => (
          <li class="wg-sidebar-section" key={node.href}>
            <SidebarNode depth={1} node={node} />
          </li>
        ))}
      </ul>
    </>
  );
}

/** The sticky aside, with the button that collapses it out of the way. */
export function WorkingGroupSidebar({ tree, wgId }: { tree: SiteSidebarTree; wgId: string }) {
  return (
    <aside class={`wg-sidebar-wrap wg-${wgId.toLowerCase()}`} id="wg-sidebar-wrap">
      <button class="wg-sidebar-toggle" id="wg-sidebar-collapse-btn" aria-label="Collapse sidebar" aria-expanded="true">
        <IconChevron pointing="left" width="12" height="12" />
      </button>
      <nav class="wg-sidebar" aria-label="Section navigation">
        <WorkingGroupSidebarTree tree={tree} />
      </nav>
    </aside>
  );
}
