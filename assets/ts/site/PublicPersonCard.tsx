import { SiteImage } from "./SiteImage";
import type { ComponentChildren } from "preact";
import type { PublicOrganizationPerson } from "../../shared/schemas/public-person";
import { Avatar } from "../ui/Avatar";
import { LinkList } from "../ui/LinkList";
import { EMPTY_DATE, formatServiceDate } from "../../shared/format-date";

import "./leadership.css";

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
      {person.organizationLogoUrl ? (
        <PublicPersonOrgLink person={person} className="person-card-org-logo-wrap">
          <SiteImage
            portrait
            src={person.organizationLogoUrl}
            alt={person.organizationName}
            class="person-card-org-logo"
            loading="lazy"
          />
        </PublicPersonOrgLink>
      ) : (
        <PublicPersonOrgLink person={person} className="person-card-org-name">
          {person.organizationName}
        </PublicPersonOrgLink>
      )}
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
    <div class={`person-card${past ? " person-card--past" : ""}`}>
      <div class="person-card-main">
        <div class={frameClasses}>
          {/* The name is the next thing in the card, so the portrait is decorative. */}
          <Avatar name={person.name} src={person.photoUrl ?? undefined} />
          <span class={`person-card-role-arc${past ? " person-card-role-arc--past" : ""}`}>{role}</span>
        </div>
        <div class="person-card-body">
          <div class="pk-cluster pk-stack--snug">
            <span class="person-card-name">{person.name}</span>
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
      {tenure && (
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
