/**
 * RowActions — the end of a table row: what this row IS, then what can be
 * done to it.
 *
 * Rows used to end in a line of inline buttons — Revoke, Remove, Delete — or
 * in an icon-only toggle whose meaning depended on its current state. Both
 * scale badly: the buttons crowd out the row's actual content on a narrow
 * screen, and an icon that means "revoke" when lit and "restore" when dim is
 * a puzzle, not a control. A row states its status in words, shows a lone
 * action as a button, and collapses two or more into one menu.
 *
 * Clicks and key presses inside the cell do not bubble. A row is often itself
 * clickable, and opening its menu must not also navigate away from it.
 *
 * Whichever form the row takes, its control is named after the row's subject:
 * a page of rows must never be a page of controls that all announce the same
 * name. See `rowActionName` below for the phrasing and why.
 */

import type { ComponentChildren } from "preact";

import { Menu, type MenuItem } from "./Menu";

import "./RowActions.css";

export interface RowActionsProps {
  /** The row's state, already in words — text, or a Badge. */
  status?: ComponentChildren;
  actions: readonly MenuItem[];
  /**
   * The row's subject, in words: a person's name, an email address, a list
   * label. Both control names are derived from it here, so no call site has
   * to remember the convention or which form its row will take.
   */
  subject?: string;
}

/**
 * Accessible name for a row's lone inline action.
 *
 * The visible text stays the action — "Remove", "Revoke grant" — because that
 * is what the reader is choosing. But ten rows of "Remove" leave ten controls
 * with one name between them: nothing in a screen reader's element list, or in
 * a spec's locator, says which row is about to lose its member. So the name
 * carries the subject too.
 *
 * The comma is load-bearing. Subjects here are arbitrary phrases — an email
 * address, "read granted to ada@example.org" — and joining with a space runs
 * the action into the subject as one sentence ("Revoke grant read granted to
 * …"). A comma is announced as a pause by every screen reader at its default
 * punctuation level, so the name reads as the two parts it is: this action, on
 * this row.
 */
export function rowActionName(action: string, subject: string): string {
  return `${action}, ${subject}`;
}

/**
 * Accessible name for the menu a row shows once it has two or more actions.
 *
 * A row with no subject falls back to naming the control's job. That is worse
 * than naming the row and is not a shape to reach for, but it is still a name,
 * and it keeps a subject an optional prop rather than a second thing every
 * call site must supply before it can render anything at all.
 */
export function rowActionsMenuName(subject: string | undefined): string {
  return subject === undefined ? "Row actions" : `Actions for ${subject}`;
}

export function RowActions({ status, actions, subject }: RowActionsProps) {
  return (
    <div
      class="pk-row-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {status !== undefined && <span class="pk-row-actions__status">{status}</span>}
      {/*
       * Always the menu, even for one action. This went to an inline button
       * once, to save a click — and a column where some rows show a button
       * and others show `…`, depending on how many commands each row happens
       * to have, reads as broken. The maintainer's reference design puts `…`
       * on every row: the ROW is the primary affordance, commands are its
       * menu, and the column looks the same from top to bottom.
       *
       * End-aligned: a start-aligned popup on the last column hangs off the
       * table's right edge before the viewport clamp ever gets a say.
       */}
      {actions.length > 0 && <Menu label={rowActionsMenuName(subject)} items={actions} align="end" />}
    </div>
  );
}
