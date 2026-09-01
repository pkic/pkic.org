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
 * The heading is the page's `<h2>` (the shell owns `<h1>`), and the header
 * labels itself with it, so a screen-reader user landing on the region hears
 * the subject. Context takes Badges; `actions` takes Buttons. Neither slot is
 * for prose.
 */

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

import "./PageHeader.css";

export interface PageHeaderProps {
  /** The trail. Omit at a section root, where the sidebar already says it. */
  trail?: ReadonlyArray<BreadcrumbItem>;
  /** The page's subject — a record's name, or the section's, never both. */
  title: string;
  /** The subject's standing: Badges, a count, a status. */
  context?: ComponentChildren;
  /** What can be done from here: Buttons, right-aligned. */
  actions?: ComponentChildren;
  /** One quiet sentence under the title, when the subject needs one. */
  description?: string;
}

export function PageHeader({ trail, title, context, actions, description }: PageHeaderProps) {
  const headingId = useId();

  return (
    <header class="pk-page-header" aria-labelledby={headingId}>
      {trail && trail.length > 0 && <Breadcrumb items={trail} />}
      <div class="pk-page-header__row">
        <div class="pk-page-header__subject">
          <h2 class="pk-page-header__title" id={headingId}>
            {title}
          </h2>
          {context && <span class="pk-page-header__context">{context}</span>}
        </div>
        {actions && <div class="pk-page-header__actions">{actions}</div>}
      </div>
      {description && <p class="pk-page-header__description">{description}</p>}
    </header>
  );
}
