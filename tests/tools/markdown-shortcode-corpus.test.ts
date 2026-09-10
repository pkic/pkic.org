/**
 * The gate under issue #12.
 *
 * `data/members/*.yaml` is the corpus that becomes `organizations.
 * content_markdown`, and every `{{< … >}}` in it is a promise the renderer has
 * to keep. The registry currently covers the three shortcodes the corpus uses;
 * the moment somebody adds a member page carrying a fourth, that page would
 * silently lose the block — so this fails the build instead, naming the
 * shortcode and the file, and the fix is to teach the registry or to rewrite
 * the content.
 *
 * It also checks the corpus's *supported* shortcodes actually resolve: a
 * `{{< youtube >}}` with no id, or a `{{< video >}}` with no `link`, resolves
 * to nothing, which is a member page quietly missing its video.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findMarkdownShortcodes,
  markdownShortcodeUrl,
  SUPPORTED_MARKDOWN_SHORTCODES,
} from "../../assets/shared/markdown-shortcodes";

const MEMBER_DATA_DIR = path.join(process.cwd(), "data", "members");

interface CorpusShortcode {
  file: string;
  name: string;
  argument: string;
  raw: string;
}

/**
 * Every shortcode in the member corpus. Read as raw text rather than parsed
 * YAML on purpose: the question is what characters are stored, and a YAML
 * loader would answer a different one (and would make one malformed file
 * hide every shortcode in the rest of the corpus).
 */
function corpusShortcodes(): CorpusShortcode[] {
  if (!fs.existsSync(MEMBER_DATA_DIR)) return [];
  return fs
    .readdirSync(MEMBER_DATA_DIR)
    .filter((name) => name.endsWith(".yaml"))
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(MEMBER_DATA_DIR, name), "utf8");
      return findMarkdownShortcodes(source).map((shortcode) => ({ file: name, ...shortcode }));
    });
}

describe("member content shortcodes", () => {
  const shortcodes = corpusShortcodes();

  it("finds the corpus it is meant to be guarding", () => {
    // A directory that has moved would otherwise make this suite pass by
    // examining nothing at all.
    expect(fs.existsSync(MEMBER_DATA_DIR)).toBe(true);
    expect(shortcodes.length).toBeGreaterThan(0);
  });

  it("uses only shortcodes the renderer supports", () => {
    const unsupported = shortcodes
      .filter((shortcode) => !(SUPPORTED_MARKDOWN_SHORTCODES as readonly string[]).includes(shortcode.name))
      .map((shortcode) => `${shortcode.file}: ${shortcode.raw}`);
    expect(unsupported).toEqual([]);
  });

  it("gives every shortcode an argument that resolves to a URL", () => {
    const unresolved = shortcodes
      .filter((shortcode) => markdownShortcodeUrl(shortcode) === null)
      .map((shortcode) => `${shortcode.file}: ${shortcode.raw}`);
    expect(unresolved).toEqual([]);
  });
});
