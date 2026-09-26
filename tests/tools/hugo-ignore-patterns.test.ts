/**
 * What the site excludes must depend on the site, not on where it is checked out.
 *
 * Hugo matches every `ignoreFiles` regex against a file's **absolute** path.
 * Two of the patterns were wrong in opposite directions because of it: `^\.`
 * can never match a path that begins with `/`, so it excluded nothing at all;
 * and `/\.` matched a hidden *ancestor* directory just as happily as a hidden
 * one inside the site, so a checkout under a dot-directory — a git worktree
 * in `.claude/worktrees`, say — ignored the whole site. Hugo emitted 14 pages
 * instead of 300-odd and said nothing, which took `generate:public` and the
 * CSS budget with it: both gates passed against an almost empty site.
 *
 * The failure is silent by nature, so it is checked here rather than noticed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const CONFIG = path.resolve("config.yaml");

/** A checkout under a hidden directory. Nothing in it may be ignored for that reason. */
const AWKWARD_ROOT = "/Users/someone/Code/pkic.org/.claude/worktrees/agent-1";
/** An ordinary checkout, for comparison. */
const PLAIN_ROOT = "/Users/someone/Code/pkic.org";

const SITE_FILES = [
  "content/_index.md",
  "content/blog/a-post/index.md",
  "layouts/_default/all.og-card.html",
  "assets/ts/loader.ts",
  "data/members/example.yaml",
  "static/img/logo.svg",
];

const HIDDEN_INSIDE_THE_SITE = [
  "content/blog/.drafts/unfinished.md",
  "static/.well-known/security.txt",
  "layouts/.backup/single.html",
];

function ignorePatterns(): RegExp[] {
  const config = parse(fs.readFileSync(CONFIG, "utf8")) as { ignoreFiles?: string[] };
  const patterns = config.ignoreFiles ?? [];
  expect(patterns.length).toBeGreaterThan(0);
  return patterns.map((pattern) => new RegExp(pattern));
}

function ignored(patterns: RegExp[], absolutePath: string): boolean {
  return patterns.some((pattern) => pattern.test(absolutePath));
}

describe("Hugo's ignoreFiles patterns", () => {
  it("ignore the same files wherever the repository is checked out", () => {
    const patterns = ignorePatterns();
    for (const file of SITE_FILES) {
      expect(
        ignored(patterns, `${AWKWARD_ROOT}/${file}`),
        `${file} is excluded only because an ancestor directory is hidden`,
      ).toBe(false);
      expect(ignored(patterns, `${PLAIN_ROOT}/${file}`)).toBe(false);
    }
  });

  it("still ignore what is hidden inside the site itself", () => {
    const patterns = ignorePatterns();
    for (const file of HIDDEN_INSIDE_THE_SITE) {
      expect(ignored(patterns, `${PLAIN_ROOT}/${file}`), `${file} should be ignored`).toBe(true);
      expect(ignored(patterns, `${AWKWARD_ROOT}/${file}`), `${file} should be ignored`).toBe(true);
    }
  });

  it("still ignore the instruction files, anywhere in the tree", () => {
    const patterns = ignorePatterns();
    for (const file of ["AGENTS.md", "content/blog/CLAUDE.md"]) {
      expect(ignored(patterns, `${PLAIN_ROOT}/${file}`), `${file} should be ignored`).toBe(true);
    }
    // And not a file that merely ends in one of those words.
    expect(ignored(patterns, `${PLAIN_ROOT}/content/blog/USING-AGENTS.md`)).toBe(false);
  });
});
