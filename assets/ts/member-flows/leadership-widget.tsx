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
import {
  groupDirectoryResponseSchema,
  type GroupDirectoryResponse,
  type PublicGroupRosterEntry,
} from "../../shared/schemas/group-directory";
import { getJson } from "../shared/api-client";
import { PublicPersonCard } from "./components/public-person-card";

const API_BASE_FALLBACK = "/api/v1";

type View = "roster" | "leadership";

/** Closed seats and closed terms as one timeline, most recently ended first. */
function pastPositions(directory: GroupDirectoryResponse, view: View): PublicGroupRosterEntry[] {
  const terms: PublicGroupRosterEntry[] = directory.pastLeadership.map((assignment) => ({
    person: assignment.person,
    title: assignment.title,
    startsAt: assignment.startsAt,
    endsAt: assignment.endsAt,
  }));
  const seats = view === "roster" ? (directory.roster?.past ?? []) : [];
  return [...terms, ...seats].sort((a, b) => (b.endsAt ?? "").localeCompare(a.endsAt ?? ""));
}

function currentPositions(directory: GroupDirectoryResponse, view: View): PublicGroupRosterEntry[] {
  if (view === "roster" && directory.roster) return directory.roster.current;
  return directory.leadership.map((assignment) => ({
    person: assignment.person,
    title: assignment.title,
    startsAt: assignment.startsAt,
    endsAt: assignment.endsAt,
  }));
}

export function GroupGovernanceWidget({
  apiBase,
  slug,
  view,
  color,
  pastHeadingHtml,
}: {
  apiBase: string;
  slug: string;
  view: View;
  color: string;
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
  const current = currentPositions(directory, view);
  const past = pastPositions(directory, view);
  if (current.length === 0 && past.length === 0) return null;

  return (
    <>
      {current.length > 0 && (
        <div class="consortium-leaders" data-positions="current">
          {current.map((entry, index) => (
            <PublicPersonCard
              key={`current-${index}`}
              person={entry.person}
              role={entry.title}
              color={color}
              from={entry.startsAt}
            />
          ))}
        </div>
      )}
      {past.length > 0 && (
        <div class="consortium-past-leadership">
          {pastHeadingHtml && <div dangerouslySetInnerHTML={{ __html: pastHeadingHtml }} />}
          {/*
            The same grid and the same card the sitting members get. A past
            position had its own one-line vocabulary — a small avatar, a role
            pill, the dates run together — which is what issue #25 means by
            "the content does not render to a tile like the active board
            members", and which is where the oval portrait and the missing
            profile link lived. It also had to be kept in step with the card
            by hand, and was not. The grey ring and the closed term are the
            whole difference now.
          */}
          <div class="consortium-leaders" data-positions="past">
            {past.map((entry, index) => (
              <PublicPersonCard
                // By position: two people the system cannot name would
                // otherwise collide on the same key and render as one.
                key={`past-${index}`}
                person={entry.person}
                role={entry.title}
                color={color}
                from={entry.startsAt}
                till={entry.endsAt}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-leadership]").forEach((root) => {
    const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
    const slug = root.dataset.group ?? "";
    const view: View = root.dataset.view === "leadership" ? "leadership" : "roster";
    const color = root.dataset.color ?? "green";
    if (!slug) return;
    const pastHeadingHtml = root.querySelector<HTMLTemplateElement>("template[data-past-heading]")?.innerHTML;
    render(
      <GroupGovernanceWidget
        apiBase={apiBase}
        slug={slug}
        view={view}
        color={color}
        pastHeadingHtml={pastHeadingHtml}
      />,
      root,
    );
  });
}

main();
