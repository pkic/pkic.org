/**
 * The plain-text part of an email says what the HTML part says, and nothing else.
 *
 * Seeded fragments of inline marks, block tags and character references are rendered and then held
 * to what a reader of a plain-text mail expects: no character reference left undecoded, no stray
 * space before punctuation that followed an inline mark, no indented lines, no double spaces.
 */
import { describe, expect, it } from "vitest";
import { renderEmail } from "../functions/_lib/email/render";
import { pick, pieces, seededRandom } from "./helpers/fuzz";

const LAYOUT = "<!doctype html><html><body>{{{body_html}}}</body></html>";
const WORDS = [
  "Open",
  "your",
  "registration",
  "portal",
  "R&amp;D",
  "Q&amp;A",
  "&rarr;",
  "&bull;",
  "&mdash;",
  "&nbsp;",
  "&#9888;&#65039;",
  "&zwnj;",
  "&hellip;",
  "&times;",
  "&copy;",
  "&constructor;",
  "&toString;",
  "&hasOwnProperty;",
];
const SPACES = new Set(["&nbsp;", "&zwnj;"]);
const LINKS = ["https://app.test/status/?id=1&amp;token=a", "https://app.test/x?a=1&amp;b=2&amp;c=3"];
const INLINE = ["strong", "b", "em", "i", "u", "span", "code"];
const PUNCTUATION = [".", ",", ";", ":", "!", "?", ")"];

function fragment(random: () => number): string {
  const paragraphs = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
    const words = pieces(random, WORDS, 2, 6, " ");
    const tag = pick(random, INLINE);
    const content = pick(
      random,
      WORDS.filter((word) => !SPACES.has(word)),
    );
    const marked = `<${tag}>${content}</${tag}>${pick(random, PUNCTUATION)}`;
    const link = random() < 0.4 ? ` <a href="${pick(random, LINKS)}">open</a>` : "";
    return `<p>${words} ${marked} ${pieces(random, WORDS, 1, 3, " ")}${link}</p>`;
  });
  return paragraphs.join("");
}

describe.each([101, 202, 303])("plain-text fallback (seed %i)", (seed) => {
  it("reads as plain text", async () => {
    const random = seededRandom(seed);
    const failures: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const source = fragment(random);
      const { text } = await renderEmail(source, {}, LAYOUT);
      const problems: string[] = [];
      if (/&(?:amp|lt|gt|quot|nbsp|zwnj|rarr|bull|mdash|hellip|times|copy|#\d+);/i.test(text))
        problems.push("undecoded reference");
      if (
        /[ \t]+[.,;:!?)]/.test(text.replace(/\n/g, " ").replace(/\.\.\./g, "")) &&
        /<\/(?:strong|b|em|i|u|span|code)>[.,;:!?)]/.test(source)
      )
        problems.push("space before punctuation");
      if (/^[ \t]+\S/m.test(text)) problems.push("indented line");
      if (/&amp;|function /.test(text)) problems.push("encoded or leaked text");
      if (/\S {2,}\S/.test(text)) problems.push("double space");
      if (problems.length)
        failures.push(`#${index} ${problems.join(", ")}: ${JSON.stringify(source)} -> ${JSON.stringify(text)}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});
