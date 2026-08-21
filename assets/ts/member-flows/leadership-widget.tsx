/**
 * Board of Directors / Executive Council / PKIC forum chair display.
 * Replaces the static content/about/board.md, executive-council.md
 * person-card lists and _index.md's hardcoded "Chair and Vice Chair"
 * section — all three are now admin-managed (Admin → Leadership) and
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
 *   - "forum" — GET /api/v1/leadership/forum-chairs. Renders the PKIC-wide
 *     chair/vice-chair pair only (no past-position history is tracked for
 *     this pair — it's the same role-forum_chair/role-forum_vice_chair
 *     user_roles assignment the admin Leadership tab's "Forum" card
 *     manages, not a leadership_positions row).
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  forumChairsPublicResponseSchema,
  leadershipPublicResponseSchema,
  type ForumChairsPublicResponse,
  type LeadershipPublicResponse,
} from "../../shared/schemas/leadership";
import { getJson } from "../shared/api-client";
import { initialsFor, PublicPersonCard, PublicPersonOrgLink, type PublicPerson } from "./components/public-person-card";

const API_BASE_FALLBACK = "/api/v1";

function monthYear(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

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
          <img class="person-tl-avatar" src={person.photoUrl} alt={person.name} loading="lazy" />
        ) : (
          <div class={`person-tl-avatar person-tl-avatar--initials wg-${color}`}>{initialsFor(person.name)}</div>
        )}
      </div>
      <div class="person-tl-info">
        <span class="person-tl-name">{person.name}</span>
        <span class="person-tl-role">{role}</span>
        <span class="person-tl-dates">
          {monthYear(from)} – {monthYear(till)}
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

function RosterWidget({ apiBase, body, color }: { apiBase: string; body: string; color: string }) {
  const [data, setData] = useState<LeadershipPublicResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson<unknown>(`${apiBase}/leadership/${encodeURIComponent(body)}`)
      .then((response) => setData(leadershipPublicResponseSchema.parse(response)))
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

function ForumWidget({ apiBase, color }: { apiBase: string; color: string }) {
  const [data, setData] = useState<ForumChairsPublicResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson<unknown>(`${apiBase}/leadership/forum-chairs`)
      .then((response) => setData(forumChairsPublicResponseSchema.parse(response)))
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

    if (source === "forum") {
      render(<ForumWidget apiBase={apiBase} color={color} />, root);
      return;
    }

    const body = root.dataset.body ?? "";
    if (!body) return;
    render(<RosterWidget apiBase={apiBase} body={body} color={color} />, root);
  });
}

main();
