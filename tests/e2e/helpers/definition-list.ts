/**
 * Reading one record's fields out of a description list.
 *
 * Several surfaces that used to render a borderless two-column `<table>` for a
 * single record's fields now render a `<dl>`, which is what the markup always
 * meant: a label and its value, once each. `getByRole("cell", …)` therefore
 * finds nothing, and reaching for the text alone would only prove the value is
 * somewhere on the page rather than that it is the answer to its own label.
 *
 * `dt` is exposed as `term` and `dd` as `definition`, so a spec can ask for
 * "the value under Job title" and get an assertion that survives the next
 * restyle — and fails when a value drifts to the wrong label.
 */

import type { Locator, Page } from "@playwright/test";

/** The `<dd>` that answers the `<dt>` reading exactly `term`, within `scope`. */
export function definitionFor(scope: Page | Locator, term: string): Locator {
  return scope
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
    .locator("xpath=following-sibling::dd[1]");
}
