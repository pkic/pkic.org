import { usePersonCard, personAffiliation } from "./PersonCard";
import type { ComponentChildren } from "preact";
import type { PublicOrganizationPerson } from "../../shared/schemas/public-person";
import { Avatar } from "../ui/Avatar";
import { LinkList } from "../ui/LinkList";
import { IconCalendar } from "../ui/MediaIcons";
import { EMPTY_DATE, formatServiceDate } from "../../shared/format-date";

import "./leadership.css";
import { ExternalLink } from "../ui/ExternalLink";

export type PublicPerson = PublicOrganizationPerson;

export function PublicPersonOrgLink({
  person,
  className,
  children,
}: {
  person: PublicPerson;
  className: string;
  children: ComponentChildren;
}) {
  return person.organizationWebsite ? (
    <ExternalLink
      href={person.organizationWebsite}
      external
      title={person.organizationName ?? undefined}
      class={className}
    >
      {children}
    </ExternalLink>
  ) : (
    <span class={className}>{children}</span>
  );
}

/**
 * The person's own profile links, in the same marked vocabulary every other
 * surface uses. This was a bare text link showing the site name and nothing
 * else — no styling of its own existed for the class it carried — which is
 * what issue #13 means by "should use the badge instead of text".
 */
export function PersonLinks({ person }: { person: PublicPerson }) {
  if (!person.featuredLink) return null;
  // Named after the person: a page of ten cards otherwise offers ten links
  // all carrying the same site label, which is nothing to choose between
  // when they are read out on their own.
  return <LinkList compact links={[person.featuredLink]} ownerName={person.name} />;
}

function OrganizationBlock({ person }: { person: PublicPerson }) {
  if (!person.organizationName) return null;
  return (
    <div class="person-card-org">
      <PublicPersonOrgLink person={person} className="person-card-org-logo-wrap">
        <Avatar
          name={person.organizationName}
          src={person.organizationLogoUrl ?? undefined}
          shape="square"
          class="person-card-org-logo"
        />
      </PublicPersonOrgLink>
    </div>
  );
}

export function PublicPersonCard({
  person,
  role,
  avatarSize = "default",
  from,
  till,
}: {
  person: PublicPerson;
  role: string;
  avatarSize?: "default" | "small";
  from?: string;
  till?: string | null;
}) {
  const subject = {
    name: person.name,
    photoUrl: person.photoUrl,
    affiliation: personAffiliation(person.jobTitle, person.organizationName),
    sessionRole: role,
  };
  const preview = usePersonCard<HTMLButtonElement>({ person: subject });
  const past = Boolean(till);
  /*
   * A term is shown only when at least one of its ends is a date that can
   * actually be written down. A start the formatter cannot parse otherwise
   * produced "In role since —", which says less than saying nothing.
   */
  const fromLabel = formatServiceDate(from);
  const tillLabel = formatServiceDate(till);
  const tenure = fromLabel !== EMPTY_DATE || tillLabel !== EMPTY_DATE;
  const frameClasses = [
    "person-card-avatar-frame",
    past ? "person-card-avatar-frame--past" : "",
    avatarSize === "small" ? "person-card-avatar-frame--small" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-person-card={JSON.stringify(subject)}
      data-module="member-flows/public-person-previews"
      {...preview.hoverProps}
      class={`person-card${past ? " person-card--past" : ""}`}
    >
      <div class="person-card-main">
        <div class={frameClasses}>
          {/* The name is the next thing in the card, so the portrait is decorative. */}
          <Avatar name={person.name} src={person.photoUrl ?? undefined} class="pk-public-person-avatar" />
          <span class={`person-card-role-arc${past ? " person-card-role-arc--past" : ""}`}>{role}</span>
        </div>
        <div class="person-card-body">
          <div class="pk-cluster pk-stack--snug">
            <button
              type="button"
              class="person-card-name"
              ref={(element) => {
                preview.anchorRef.current = element;
                const card = element?.closest<HTMLElement>(".person-card");
                if (card) card.dataset.personCardHydrated = "true";
              }}
              {...preview.toggleProps}
            >
              {person.name}
            </button>
            <PersonLinks person={person} />
          </div>
          {/*
            The line under the name says what this person is, not where they
            work: their own job title, or — when the profile carries none —
            the title their term was made with. The employer is the
            organization block directly below, with its logo and its link, and
            naming it here as well said the company twice and the person's
            standing nowhere but an 8px badge on the ring (issue #19).
          */}
          {(person.jobTitle || role) && (
            <div class="person-card-jobtitle" title={person.jobTitle ?? role}>
              {person.jobTitle ?? role}
            </div>
          )}
          <OrganizationBlock person={person} />
        </div>
      </div>
      {preview.card}
      {tenure && (
        <div class="person-card-footer">
          <IconCalendar width="11" height="11" />
          <span class="person-card-footer-label">
            {fromLabel !== EMPTY_DATE && tillLabel === EMPTY_DATE ? "In role since" : "In role"}
          </span>
          <span class="person-card-footer-dates">
            {fromLabel !== EMPTY_DATE && tillLabel === EMPTY_DATE && fromLabel}
            {fromLabel !== EMPTY_DATE && tillLabel !== EMPTY_DATE && `${fromLabel} – ${tillLabel}`}
            {fromLabel === EMPTY_DATE && tillLabel !== EMPTY_DATE && `Until ${tillLabel}`}
          </span>
        </div>
      )}
    </div>
  );
}
