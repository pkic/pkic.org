/**
 * Board of Directors / Executive Council / consortium chair display.
 * Replaces the static content/about/board.md, executive-council.md
 * person-card lists and _index.md's hardcoded "Chair and Vice Chair"
 * section — all three are now managed in the portal's System → Leadership section and
 * fetched client-side, the same pattern wg-chairs-widget.tsx already
 * established for working-group chairs (see that file's header comment
 * for the full rationale).
 *
 * Two data shapes, chosen via the mount's `data-source` attribute:
 *   - "roster" — GET /api/v1/leadership/:body (board | executive_council).
 *     Renders a `.consortium-leaders` grid of current members plus a
 *     `.consortium-past-timeline` for past positions, mirroring
 *     consortium-leadership.html's static rendering exactly (same CSS
 *     classes) but sourced from D1 instead of page front-matter.
 *   - "consortium" — GET /api/v1/leadership/consortium-chairs. Renders the
 *     published chair/vice-chair pair for the All Members group. Past-position
 *     history is not tracked for this role assignment.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  consortiumChairsPublicResponseSchema,
  leadershipPublicResponseSchema,
  type ConsortiumChairsPublicResponse,
  type LeadershipPublicResponse,
} from "../../shared/schemas/leadership";
import { getJson } from "../shared/api-client";
import { formatMonthYear } from "../shared/ui";
import { initialsFor, PublicPersonCard, PublicPersonOrgLink, type PublicPerson } from "./components/public-person-card";

const API_BASE_FALLBACK = "/api/v1";

function TimelineItem({
  person,
  role,
  color,
  from,
  till,
}: {
  person: PublicPerson;
  role: string;
  color: string;
  from: string;
  till: string;
}) {
  return (
    <div class="person-tl-item">
      <div class="person-tl-avatar-wrap">
        {person.photoUrl ? (
          // The name follows in `person-tl-name`, so an alt repeating it makes
          // a screen reader say it twice.
          <img class="person-tl-avatar" src={person.photoUrl} alt="" loading="lazy" />
        ) : (
          <div class={`person-tl-avatar person-tl-avatar--initials wg-${color}`}>{initialsFor(person.name)}</div>
        )}
      </div>
      <div class="person-tl-info">
        <span class="person-tl-name">{person.name}</span>
        <span class="person-tl-role">{role}</span>
        <span class="person-tl-dates">
          {formatMonthYear(from)} – {formatMonthYear(till)}
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

export function RosterWidget({ apiBase, body, color }: { apiBase: string; body: string; color: string }) {
  const [data, setData] = useState<LeadershipPublicResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson(`${apiBase}/leadership/${encodeURIComponent(body)}`, leadershipPublicResponseSchema)
      .then((response) => setData(response))
      .catch(() => setFailed(true));
  }, [apiBase, body]);

  if (failed || !data || (data.current.length === 0 && data.past.length === 0)) return null;

  return (
    <>
      {data.current.length > 0 && (
        <div class="consortium-leaders">
          {data.current.map((p) => (
            <PublicPersonCard
              key={`${p.name}-${p.title}`}
              person={p}
              role={p.title}
              color={color}
              from={p.startsAt}
              till={p.endsAt}
            />
          ))}
        </div>
      )}
      {data.past.length > 0 && (
        <div class="consortium-past-leadership">
          <h4 class="consortium-past-heading">Past positions</h4>
          <div class="consortium-past-timeline">
            {data.past.map((p) => (
              <TimelineItem
                key={`${p.name}-${p.title}-${p.endsAt}`}
                person={p}
                role={p.title}
                color={color}
                from={p.startsAt}
                till={p.endsAt!}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function ConsortiumWidget({ apiBase, color }: { apiBase: string; color: string }) {
  const [data, setData] = useState<ConsortiumChairsPublicResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson(`${apiBase}/leadership/consortium-chairs`, consortiumChairsPublicResponseSchema)
      .then((response) => setData(response))
      .catch(() => setFailed(true));
  }, [apiBase]);

  const hasData = !failed && !!data && (!!data.chair || !!data.viceChair);
  if (!hasData) return null;

  return (
    <div class="consortium-leaders">
      {data!.chair && <PublicPersonCard person={data!.chair} role="Chair" color={color} from={data!.chair.startsAt} />}
      {data!.viceChair && (
        <PublicPersonCard person={data!.viceChair} role="Vice Chair" color={color} from={data!.viceChair.startsAt} />
      )}
    </div>
  );
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-leadership]").forEach((root) => {
    const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
    const source = root.dataset.source ?? "roster";
    const color = root.dataset.color ?? "green";

    if (source === "consortium") {
      render(<ConsortiumWidget apiBase={apiBase} color={color} />, root);
      return;
    }

    const body = root.dataset.body ?? "";
    if (!body) return;
    render(<RosterWidget apiBase={apiBase} body={body} color={color} />, root);
  });
}

main();
