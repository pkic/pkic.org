/**
 * Every block tag in a seeded email template is one the renderer knows.
 *
 * `functions/_lib/email/render.ts` speaks Handlebars: `{{#if x}}`,
 * `{{#unless x}}`, `{{#each xs}}`. It does not speak Mustache's implicit
 * sections, `{{#x}}…{{/x}}`, and it does not fail on them either — an
 * unrecognized block is left exactly as written, so the braces go out in the
 * email. That is what issue #32 reported on a sponsorship confirmation, and
 * six other templates had the same thing waiting in them: an application
 * decline, two review batches, the welcome mail, a mailing-list enrolment,
 * and the leadership digest.
 *
 * Reading the seeded SQL rather than rendering each template is deliberate.
 * Rendering needs plausible data per template, and a template nobody thought
 * to supply data for is exactly the one that would slip through; the syntax
 * is checkable without any.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The block helpers `compileSimpleTemplate` implements. */
const KNOWN_BLOCK_HELPERS = new Set(["if", "unless", "each"]);

const MIGRATION = path.resolve("migrations/0035_membership_portal_governance.sql");

describe("seeded email template block syntax", () => {
  it("uses no block helper the renderer would leave on the page", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const unknown = [...sql.matchAll(/\{\{#\s*([A-Za-z_][\w.]*)/g)]
      .map((match) => match[1])
      .filter((helper) => !KNOWN_BLOCK_HELPERS.has(helper));

    // Named, not counted: the failure should say which tag to fix.
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("closes every block with the helper that opened it", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const opens = [...sql.matchAll(/\{\{#\s*(if|unless|each)\b/g)].map((match) => match[1]);
    const closes = [...sql.matchAll(/\{\{\/\s*([A-Za-z_][\w.]*)\s*\}\}/g)].map((match) => match[1]);

    // A `{{/applications}}` left behind after its opener was converted is
    // just as inert as the opener was, and just as invisible in review.
    const closeTally = closes.reduce<Record<string, number>>((tally, helper) => {
      tally[helper] = (tally[helper] ?? 0) + 1;
      return tally;
    }, {});
    const openTally = opens.reduce<Record<string, number>>((tally, helper) => {
      tally[helper] = (tally[helper] ?? 0) + 1;
      return tally;
    }, {});
    expect(closeTally).toEqual(openTally);
  });
});
