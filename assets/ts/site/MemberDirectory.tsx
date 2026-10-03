import { SiteImage } from "./SiteImage";
import { useMemo, useState } from "preact/hooks";
import type { PublicMemberSummary } from "../../shared/schemas/members-directory";
import { memberProfileHref } from "../../shared/member-profile-url";
import { Avatar } from "../ui/Avatar";
import { EmptyState } from "../ui/RecordEmptyState";
import "./member-directory.css";
const DIGITS = new Set("0123456789".split(""));

export type DirectoryMember = PublicMemberSummary;

function letterBucket(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  if (DIGITS.has(c)) return "#";
  if (/^[A-Z]$/.test(c)) return c;
  return "…";
}

export function MemberCard({ member }: { member: DirectoryMember }) {
  // Decided in `assets/shared/member-profile-url.ts`, not here: the wall, the
  // charter roll and this grid all link to the same page and used to answer
  // "where is it?" three separate ways (#15).
  const href = memberProfileHref(member);

  // A logo that fails to load is worse than no logo: the card is left with a
  // broken-image glyph and the file name as alt text, at whatever size the
  // box gives it. A handful of stored logos are malformed — `ahead.svg` holds
  // PNG bytes, for one — so a failed load falls back to the monogram the card
  // already draws for members with no logo at all.
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = Boolean(member.logoUrl) && !logoFailed;

  return (
    <div class="member-card bento-card">
      <div class="member-card-logo-wrap">
        {showLogo ? (
          <SiteImage
            class="member-card-logo"
            src={member.logoUrl ?? undefined}
            alt={`${member.name} logo`}
            loading="lazy"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <Avatar name={member.name} shape="square" />
        )}
      </div>
      <div class="member-card-name">
        <a class="pk-stretched" href={href}>
          {member.name}
        </a>
      </div>
      {member.slogan && <div class="member-card-slogan">{member.slogan}</div>}
      {member.description && (
        <p class="member-card-description">
          {member.description.length > 160 ? `${member.description.slice(0, 160).trimEnd()}…` : member.description}
        </p>
      )}
    </div>
  );
}

export function DirectoryGrid({ members, prefix }: { members: DirectoryMember[]; prefix: string }) {
  const buckets = useMemo(() => {
    const map = new Map<string, DirectoryMember[]>();
    for (const m of members) {
      const key = letterBucket(m.name);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [members]);

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const hasNum = buckets.has("#");
  const hasOther = buckets.has("…");
  const presentLetters = letters.filter((l) => buckets.has(l));

  if (members.length === 0) {
    return (
      <EmptyState
        title="No members found."
        body="No member matches your search. Try a shorter term, or clear the search to see everyone."
      />
    );
  }

  return (
    <div class="members-layout">
      {/* When the rail appears is a property of the rail, so it lives with
          the rest of its shape in `_members-directory.scss` rather than as a
          responsive display class here. */}
      <nav class="members-az-sidebar" aria-label="Jump to letter">
        {hasNum && (
          <a class="az-sidebar-link" href={`#${prefix}-NUM`}>
            #
          </a>
        )}
        {letters.map((l) =>
          buckets.has(l) ? (
            <a key={l} class="az-sidebar-link" href={`#${prefix}-${l}`}>
              {l}
            </a>
          ) : (
            <span key={l} class="az-sidebar-link is-empty" aria-disabled="true">
              {l}
            </span>
          ),
        )}
        {hasOther && (
          <a class="az-sidebar-link" href={`#${prefix}-OTHER`}>
            …
          </a>
        )}
      </nav>
      <div class="members-content">
        {hasNum && (
          <section class="member-letter-group" id={`${prefix}-NUM`}>
            <h3 class="member-letter-heading">0 – 9</h3>
            <div class="members-grid">
              {buckets.get("#")!.map((m) => (
                <MemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        )}
        {presentLetters.map((l) => (
          <section class="member-letter-group" id={`${prefix}-${l}`} key={l}>
            <h3 class="member-letter-heading">{l}</h3>
            <div class="members-grid">
              {buckets.get(l)!.map((m) => (
                <MemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        ))}
        {hasOther && (
          <section class="member-letter-group" id={`${prefix}-OTHER`}>
            <h3 class="member-letter-heading">Other</h3>
            <div class="members-grid">
              {buckets.get("…")!.map((m) => (
                <MemberCard key={m.id} member={m} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
