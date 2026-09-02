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
 *     timeline of closed seats and closed leadership terms.
 *   - "leadership" — current leaders only, then the past-terms timeline.
 * The markup and classes are those of consortium-leadership.html and
 * person-card.html, so the pages look exactly as the static lists did.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  groupDirectoryResponseSchema,
  type GroupDirectoryResponse,
  type PublicGroupRosterEntry,
} from "../../shared/schemas/group-directory";
import { getJson } from "../shared/api-client";
import {
  initialsFor,
  monthYear,
  PublicPersonCard,
  PublicPersonOrgLink,
  type PublicPerson,
} from "./components/public-person-card";

const API_BASE_FALLBACK = "/api/v1";

type View = "roster" | "leadership";

function TimelineItem({ entry, color }: { entry: PublicGroupRosterEntry; color: string }) {
  const person: PublicPerson = entry.person;
  return (
    <div class="person-tl-item">
      <div class="person-tl-avatar-wrap">
        {person.photoUrl ? (
          <img class="person-tl-avatar" src={person.photoUrl} alt={person.name} loading="lazy" />
        ) : (
          <div class={`person-tl-avatar person-tl-avatar--initials wg-${color}`}>{initialsFor(person.name)}</div>
        )}
      </div>
      <div class="person-tl-info">
        <span class="person-tl-name">{person.name}</span>
        <span class="person-tl-role">{entry.title}</span>
        <span class="person-tl-dates">
          {monthYear(entry.startsAt)}
          {entry.endsAt && ` – ${monthYear(entry.endsAt)}`}
        </span>
        {person.organizationName && (
          <span class="person-tl-org">
            <PublicPersonOrgLink person={person} className="person-tl-org-link">
              {person.organizationName}
            </PublicPersonOrgLink>
          </span>
        )}
      </div>
    </div>
  );
}

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
}: {
  apiBase: string;
  slug: string;
  view: View;
  color: string;
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
        <div class="consortium-leaders">
          {current.map((entry) => (
            <PublicPersonCard
              key={`${entry.person.name}:${entry.title}:${entry.startsAt}`}
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
          <h4 class="consortium-past-heading">Past positions</h4>
          <div class="consortium-past-timeline">
            {past.map((entry) => (
              <TimelineItem
                key={`${entry.person.name}:${entry.title}:${entry.startsAt}:${entry.endsAt ?? ""}`}
                entry={entry}
                color={color}
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
    render(<GroupGovernanceWidget apiBase={apiBase} slug={slug} view={view} color={color} />, root);
  });
}

main();
