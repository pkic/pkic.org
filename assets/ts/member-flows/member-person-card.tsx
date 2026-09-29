import { memberProfileLinks } from "../../shared/member-profile-links";
/**
 * A person named on a page, resolved through the member they act for.
 *
 * Replaces `layouts/partials/person-card.html`, which scanned every file
 * under `data/members/` at build time to find a representative by name, then
 * resolved their headshot and their organization's logo out of
 * `assets/images/members/`. That is issue #8's shape: the card described the
 * repository rather than the consortium, and a speaker whose photo or
 * employer changed after the last deploy kept the old one.
 *
 * The lookup itself is unchanged — a display name inside one named member —
 * because that is what the page gives it. Only the source moves: the public
 * member profile, which carries the same organization and the same live
 * representatives the member's own page shows, from D1 and R2.
 */
import { getFeaturedLink } from "../../shared/schemas/links";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { publicMemberDetailSchema, type PublicMemberDetail } from "../../shared/schemas/members-directory";
import { getJson } from "../shared/api-client";
import { PublicPersonCard, type PublicPerson } from "./components/public-person-card";

const API_BASE_FALLBACK = "/api/v1";

/**
 * The YAML rosters marked a representative for review with a trailing `*`,
 * and the front matter that names them was written against those files, so
 * the mark can appear on either side of this comparison.
 */
function sameName(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\*+$/, "").trim().toLowerCase();
  return normalize(left) === normalize(right);
}

/** The named person as a card subject, falling back to the member itself. */
function toPerson(member: PublicMemberDetail, name: string): PublicPerson {
  const identity = member.identities.find((entry) => sameName(entry.name, name));
  return {
    name: identity?.name ?? name.replace(/\*+$/, "").trim(),
    jobTitle: identity?.jobTitle ?? null,
    organizationName: member.name,
    organizationLogoUrl: member.logoUrl,
    organizationWebsite: member.website,
    photoUrl: identity?.photoUrl ?? null,
    featuredLink: getFeaturedLink(memberProfileLinks(identity)),
  };
}

export function MemberPersonCard({
  apiBase,
  member,
  name,
  role,
  color,
  avatarSize,
}: {
  apiBase: string;
  /** The member's public id or slug, as the page's front matter names it. */
  member: string;
  name: string;
  role: string;
  color: string;
  avatarSize?: "default" | "small";
}) {
  const [person, setPerson] = useState<PublicPerson | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson(`${apiBase}/members/${encodeURIComponent(member)}`, publicMemberDetailSchema).then(
      (detail) => {
        if (!cancelled) setPerson(toPerson(detail, name));
      },
      () => {
        /*
         * The page named this person; a member profile that cannot be read
         * does not unname them. The card falls back to the initials avatar,
         * which is what a representative with no photo on file has always
         * shown.
         */
        if (!cancelled) {
          setPerson({
            name: name.replace(/\*+$/, "").trim(),
            jobTitle: null,
            organizationName: null,
            organizationLogoUrl: null,
            organizationWebsite: null,
            photoUrl: null,
            featuredLink: null,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apiBase, member, name]);

  if (!person) return null;
  return <PublicPersonCard person={person} role={role} color={color} avatarSize={avatarSize} />;
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-member-person]").forEach((root) => {
    const member = root.dataset.member ?? "";
    const name = root.dataset.personName ?? "";
    if (!member || !name) return;
    render(
      <MemberPersonCard
        apiBase={root.dataset.apiBase ?? API_BASE_FALLBACK}
        member={member}
        name={name}
        role={root.dataset.role ?? "Speaker"}
        color={root.dataset.color ?? "green"}
        avatarSize={root.dataset.size === "sm" ? "small" : "default"}
      />,
      root,
    );
  });
}

main();
