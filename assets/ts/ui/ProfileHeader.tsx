/**
 * The identity block at the top of a record about a subject — a person, an
 * organization, a working group.
 *
 * `PageHeader` names a *place* in the portal: a title, a trail, the actions
 * available on that screen. This names a *subject*: who or what the record is
 * about, shown as itself. The two are not variants of each other, which is why
 * a record page uses this instead of dressing PageHeader with a portrait.
 *
 * Deliberately subject-agnostic. `media` takes an `Avatar` for a person and a
 * logo tile for an organization; `facts` takes whatever short statements that
 * kind of subject is identified by. A member profile and an organization
 * profile therefore share this header rather than growing two that drift.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

import { useTitleHeading } from "./HeadingOutline";

import "./ProfileHeader.css";
import "./ProfileHeader.scss";

export interface ProfileHeaderProps {
  /** The subject's portrait or mark: an `Avatar`, a logo tile, an icon. */
  media?: ComponentChildren;
  title: string;
  /**
   * A short standing shown beside the name — "Open to opportunities". Not part
   * of the name, so it is not inside the heading: a screen reader announcing
   * the heading should read the subject, not the subject plus a status.
   */
  pill?: ComponentChildren;
  /** One line saying what the subject is: a role, a sector, a charter. */
  lede?: ComponentChildren;
  /**
   * Short identifying statements — a place, a joining date, languages. Written
   * as separate entries rather than one pre-joined string so the separators
   * stay presentational and are not announced as content.
   */
  facts?: readonly ComponentChildren[];
  /** The commands available on the subject, at the end of the block. */
  actions?: ComponentChildren;
  /**
   * The authored heading level. Defaults to 2, matching `PageHeader`: the
   * record is the screen's title, which the portal renders as its `<h1>` (see
   * `HeadingOutline`). Use 3 only where the record sits below another title on
   * the same screen; use 1 where this header is a whole public page.
   */
  headingLevel?: 1 | 2 | 3;
  /**
   * `field` paints the identity block on the conference field, as the agenda's
   * session dialog does, for a person's showcase. The page that asks for it
   * loads the conference kit tokens (tokens.event.generated.css).
   */
  tone?: "surface" | "field";
  context?: ComponentChildren;
  /** Optional navigation and content keep a record inside its identity card. */
  navigation?: ComponentChildren;
  children?: ComponentChildren;
}

export function ProfileHeader({
  media,
  title,
  pill,
  lede,
  facts,
  actions,
  headingLevel = 2,
  tone = "surface",
  context,
  navigation,
  children,
}: ProfileHeaderProps) {
  const Heading = useTitleHeading(headingLevel);
  const Container = children === undefined ? "header" : "section";
  const headingId = useId();

  return (
    <Container
      class={`pk-profile-header${tone === "field" ? " pk-profile-header--field" : ""}`}
      aria-labelledby={headingId}
    >
      {/* The brand stripe is decoration and carries nothing a reader needs. */}
      <div class="pk-profile-header__stripe" aria-hidden="true" />
      <div class={`pk-profile-header__body${media === undefined ? " pk-profile-header__body--text" : ""}`}>
        {media !== undefined && <div class="pk-profile-header__media">{media}</div>}

        <div class="pk-profile-header__identity">
          <div class="pk-profile-header__name">
            <Heading class="pk-profile-header__title" id={headingId}>
              {title}
            </Heading>
            {context}
            {pill !== undefined && <span class="pk-profile-header__pill">{pill}</span>}
          </div>

          {lede !== undefined && <p class="pk-lede pk-profile-header__lede">{lede}</p>}

          {facts !== undefined && facts.length > 0 && (
            <ul class="pk-profile-header__facts pk-small pk-muted">
              {facts.map((fact, index) => (
                // Index is the only stable identity available: a fact is
                // arbitrary content, and the list is a fixed set per subject.
                <li key={index}>{fact}</li>
              ))}
            </ul>
          )}
        </div>

        {actions !== undefined && <div class="pk-profile-header__actions">{actions}</div>}
      </div>
      {navigation && <div class="pk-profile-header__navigation">{navigation}</div>}
      {children !== undefined && <div class="pk-profile-header__content">{children}</div>}
    </Container>
  );
}
