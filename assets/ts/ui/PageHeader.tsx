/**
 * PageHeader — the first region of every portal page.
 *
 * A page opens with one statement of what it is: the trail above, the subject
 * as the heading, the subject's standing beside it, and what can be done to it
 * on the right. Before this existed every screen improvised that statement —
 * the organization page managed to say "organization" three times before its
 * content began, and the Users list opened with a search box because nothing
 * else claimed the top of the page.
 *
 * The heading is the screen's title: authored at level 2, it is the
 * document's one `<h1>` inside the portal (see `HeadingOutline`). The header
 * labels itself with it, so a screen-reader user landing on the region hears
 * the subject. Context takes Badges; `actions` takes Buttons. Neither slot is
 * for prose.
 */

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";
import { useTitleHeading } from "./HeadingOutline";

import "./PageHeader.css";

export interface PageHeaderProps {
  /** The trail. Omit at a section root, where the sidebar already says it. */
  trail?: ReadonlyArray<BreadcrumbItem>;
  /** The page's subject — a record's name, or the section's, never both. */
  /** The subject's name; a node when the page edits the name in place. */
  title: ComponentChildren;
  /** The kind of record, when its parent context has its own navigation. */
  eyebrow?: string;
  /** The subject's standing: Badges, a count, a status. */
  context?: ComponentChildren;
  /** What can be done from here: Buttons, right-aligned. */
  actions?: ComponentChildren;
  /** One quiet sentence under the title, when the subject needs one. */
  description?: ComponentChildren;
  /** Mobile navigation already names this root section; keep its heading accessible. */
  hideOnMobile?: boolean;
}

export function PageHeader({ trail, title, eyebrow, context, actions, description, hideOnMobile }: PageHeaderProps) {
  const headingId = useId();
  const Heading = useTitleHeading();

  return (
    <header class={`pk-page-header${hideOnMobile ? " pk-page-header--mobile-hidden" : ""}`} aria-labelledby={headingId}>
      {trail && trail.length > 0 && <Breadcrumb items={trail} />}
      {eyebrow && <p class="pk-small pk-muted">{eyebrow}</p>}
      <div class="pk-page-header__row">
        <div class="pk-page-header__subject">
          <Heading class="pk-page-header__title" id={headingId}>
            {title}
          </Heading>
          {context && <span class="pk-page-header__context">{context}</span>}
        </div>
        {actions && <div class="pk-page-header__actions">{actions}</div>}
      </div>
      {description && <p class="pk-page-header__description pk-break">{description}</p>}
    </header>
  );
}
