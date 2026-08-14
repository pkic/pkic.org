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
import type { ComponentChildren } from "preact";
import { getJson } from "../shared/api-client";

const API_BASE_FALLBACK = "/api/v1";

interface PersonPublic {
  name: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationWebsite: string | null;
  photoUrl: string | null;
  linkedin: string | null;
}

interface RosterPerson extends PersonPublic {
  title: string;
  startsAt: string;
  endsAt: string | null;
}

interface RosterResponse {
  current: RosterPerson[];
  past: RosterPerson[];
}

interface ForumChairsResponse {
  chair: (PersonPublic & { startsAt: string }) | null;
  viceChair: (PersonPublic & { startsAt: string }) | null;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function monthYear(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function LinkedInBadge({ person }: { person: PersonPublic }) {
  if (!person.linkedin) return null;
  return (
    <a
      href={person.linkedin}
      class="person-card-linkedin"
      target="_blank"
      rel="noopener noreferrer"
      title={`${person.name} on LinkedIn`}
      aria-label="LinkedIn"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
        <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z" />
      </svg>
    </a>
  );
}

function OrgLink({
  person,
  className,
  children,
}: {
  person: PersonPublic;
  className: string;
  children: ComponentChildren;
}) {
  return person.organizationWebsite ? (
    <a
      href={person.organizationWebsite}
      target="_blank"
      rel="noopener noreferrer"
      title={person.organizationName ?? undefined}
      class={className}
    >
      {children}
    </a>
  ) : (
    <span class={className}>{children}</span>
  );
}

function OrgBlock({
  person,
  orgClass,
  logoWrapClass,
  logoClass,
  nameClass,
}: {
  person: PersonPublic;
  orgClass: string;
  logoWrapClass: string;
  logoClass: string;
  nameClass: string;
}) {
  if (!person.organizationName) return null;
  return (
    <div class={orgClass}>
      {person.organizationLogoUrl ? (
        <OrgLink person={person} className={logoWrapClass}>
          <img src={person.organizationLogoUrl} alt={person.organizationName} class={logoClass} loading="lazy" />
        </OrgLink>
      ) : (
        <OrgLink person={person} className={nameClass}>
          {person.organizationName}
        </OrgLink>
      )}
    </div>
  );
}

function PersonCard({
  person,
  role,
  color,
  avatarPx,
  from,
  till,
}: {
  person: PersonPublic;
  role: string;
  color: string;
  avatarPx: number;
  from?: string;
  till?: string | null;
}) {
  const past = Boolean(till);
  return (
    <div class={`person-card${past ? " person-card--past" : ""}`}>
      <div class="person-card-main">
        <div
          class={`person-card-avatar-frame${past ? " person-card-avatar-frame--past" : ""}`}
          style={{ "--avatar-px": `${avatarPx}px` }}
        >
          {person.photoUrl ? (
            <img class="person-card-avatar" src={person.photoUrl} alt={person.name} loading="lazy" />
          ) : (
            <div class={`person-card-avatar person-card-avatar--initials wg-${color}`}>{initialsFor(person.name)}</div>
          )}
          <span class={`person-card-role-arc${past ? " person-card-role-arc--past" : ""}`}>{role}</span>
        </div>
        <div class="person-card-body">
          <div class="person-card-name-row">
            <span class="person-card-name">{person.name}</span>
            <LinkedInBadge person={person} />
          </div>
          <OrgBlock
            person={person}
            orgClass="person-card-org"
            logoWrapClass="person-card-org-logo-wrap"
            logoClass="person-card-org-logo"
            nameClass="person-card-org-name"
          />
        </div>
      </div>
      {(from || till) && (
        <div class="person-card-footer">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="11"
            height="11"
            fill="currentColor"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="M11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm-3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm-5 3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z" />
            <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z" />
          </svg>
          <span class="person-card-footer-label">{from && !till ? "In role since" : "In role"}</span>
          <span class="person-card-footer-dates">
            {from && !till && monthYear(from)}
            {from && till && `${monthYear(from)} – ${monthYear(till)}`}
            {!from && till && `Until ${monthYear(till)}`}
          </span>
        </div>
      )}
    </div>
  );
}

function TimelineItem({
  person,
  role,
  color,
  from,
  till,
}: {
  person: PersonPublic;
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
            <OrgLink person={person} className="person-tl-org-link">
              {person.organizationName}
            </OrgLink>
          </span>
        )}
      </div>
    </div>
  );
}

function RosterWidget({ apiBase, body, color }: { apiBase: string; body: string; color: string }) {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson<RosterResponse>(`${apiBase}/leadership/${encodeURIComponent(body)}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [apiBase, body]);

  if (failed || !data || (data.current.length === 0 && data.past.length === 0)) return null;

  return (
    <>
      {data.current.length > 0 && (
        <div class="consortium-leaders">
          {data.current.map((p) => (
            <PersonCard
              key={`${p.name}-${p.title}`}
              person={p}
              role={p.title}
              color={color}
              avatarPx={80}
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
  const [data, setData] = useState<ForumChairsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson<ForumChairsResponse>(`${apiBase}/leadership/forum-chairs`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [apiBase]);

  const hasData = !failed && !!data && (!!data.chair || !!data.viceChair);
  if (!hasData) return null;

  return (
    <div class="consortium-leaders">
      {data!.chair && (
        <PersonCard person={data!.chair} role="Chair" color={color} avatarPx={80} from={data!.chair.startsAt} />
      )}
      {data!.viceChair && (
        <PersonCard
          person={data!.viceChair}
          role="Vice Chair"
          color={color}
          avatarPx={80}
          from={data!.viceChair.startsAt}
        />
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
