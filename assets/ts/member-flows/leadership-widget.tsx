/**
 * Public governance display for any group: the Board of Directors and
 * Executive Council rosters on their About pages, and the consortium chair and
 * vice chair (the All Members group's leadership) on the About overview.
 *
 * Everything comes from the public GET /api/v1/groups/:slug/directory, the
 * same endpoint the working-group sidebar uses for its chairs, so a group's
 * own "publish leadership" and "publish roster" switches decide what appears
 * here. Two views, chosen by the mount's `data-view` attribute:
 *   - "roster" (default) — current seats as a `.consortium-leaders` grid,
 *     leaders first with their leadership title, then a "Past positions"
 *     grid of closed seats and closed leadership terms.
 *   - "leadership" — current leaders only, then the past terms.
 *
 * Both grids draw the same card. A past position is the same fact as a
 * sitting one with an end date on it, and giving it a vocabulary of its own
 * meant every fix to the card — a square portrait, a marked profile link —
 * had to be made twice and was not (#25).
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { groupDirectoryResponseSchema, type GroupDirectoryResponse } from "../../shared/schemas/group-directory";
import { getJson } from "../shared/api-client";
import { GroupGovernanceView } from "../site/GroupGovernance";

import "../site/leadership.css";

const API_BASE_FALLBACK = "/api/v1";

type View = "roster" | "leadership";

export function GroupGovernanceWidget({
  apiBase,
  slug,
  view,
  pastHeadingHtml,
}: {
  apiBase: string;
  slug: string;
  view: View;
  /** Trusted HTML rendered by Hugo from the shortcode’s Markdown body. */
  pastHeadingHtml?: string;
}) {
  const [directory, setDirectory] = useState<GroupDirectoryResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson(`${apiBase}/groups/${encodeURIComponent(slug)}/directory`, groupDirectoryResponseSchema)
      .then((response) => setDirectory(response))
      .catch(() => setFailed(true));
  }, [apiBase, slug]);

  if (failed || !directory) return null;
  return <GroupGovernanceView directory={directory} view={view} pastHeadingHtml={pastHeadingHtml} />;
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-leadership]").forEach((root) => {
    const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
    const slug = root.dataset.group ?? "";
    const view: View = root.dataset.view === "leadership" ? "leadership" : "roster";
    if (!slug) return;
    const pastHeadingHtml = root.querySelector<HTMLTemplateElement>("template[data-past-heading]")?.innerHTML;
    render(<GroupGovernanceWidget apiBase={apiBase} slug={slug} view={view} pastHeadingHtml={pastHeadingHtml} />, root);
  });
}

main();
