import type { GroupDirectoryResponse, PublicGroupRosterEntry } from "../../shared/schemas/group-directory";
import { PublicPersonCard } from "./PublicPersonCard";
import "./leadership.css";
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

export function GroupGovernanceView({
  directory,
  view,
  pastHeadingHtml,
}: {
  directory: GroupDirectoryResponse;
  view: View;
  pastHeadingHtml?: string;
}) {
  const current = currentPositions(directory, view);
  const past = pastPositions(directory, view);
  if (current.length === 0 && past.length === 0) return null;

  return (
    <>
      {current.length > 0 && (
        <div class="consortium-leaders" data-positions="current">
          {current.map((entry, index) => (
            <PublicPersonCard key={`current-${index}`} person={entry.person} role={entry.title} from={entry.startsAt} />
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
