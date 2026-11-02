// @vitest-environment jsdom
/**
 * What a person types into the Markdown editor is what every screen shows afterwards.
 *
 * Seeded cases of ordinary prose with the characters Markdown and HTML treat specially: each is
 * typed into the editor, saved, reopened in a second editor and rendered on a page. The text must
 * survive all three, and a typed `&` must be stored as `&`.
 */
import { Editor } from "@tiptap/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "../../assets/ts/components/markdown-editor/editor-extensions";
import { plainAmpersands } from "../../assets/ts/components/markdown-editor/template-markdown";
import { Markdown } from "../../assets/ts/ui/Markdown";
import { pieces, seededRandom } from "../helpers/fuzz";

const WORDS = [
  "Research",
  "R&D",
  "Q&A",
  "AT&T",
  "a<b",
  "x>y",
  "&amp;",
  "&constructor;",
  "&toString;",
  "R&D;",
  "AT&T;",
  "&lt;",
  "&#39;",
  "&",
  "<b>",
  "50%",
  "e.g.",
  "naïve",
];
const MARKS = [
  "*",
  "_",
  "`",
  "[",
  "]",
  "\\",
  "~",
  "#",
  "-",
  "+",
  "|",
  "!",
  "(",
  ")",
  ">",
  "<",
  '"',
  "'",
  ":",
  ";",
  "{{",
  "}}",
];
const SCRIPTS = ["é", "ß", "Ω", "漢字", "😀", "עברית", "Ünï"];

const instances: Editor[] = [];
const roots: HTMLElement[] = [];
afterEach(() => {
  instances.splice(0).forEach((instance) => instance.destroy());
  roots.splice(0).forEach((root) => void act(() => render(null, root)));
});

function typed(text: string): Editor {
  const instance = new Editor({
    injectCSS: false,
    extensions: editorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  });
  instances.push(instance);
  return instance;
}

function reopened(markdown: string): Editor {
  const instance = new Editor({
    injectCSS: false,
    extensions: editorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  instances.push(instance);
  return instance;
}

function page(markdown: string): string {
  const root = document.createElement("div");
  roots.push(root);
  void act(() => render(<Markdown markdown={markdown} />, root));
  return root.textContent ?? "";
}

/** Words first, so a leading mark cannot turn the line into a heading, list or quote the author never asked for. */
function sentence(random: () => number): string {
  const lead = pieces(random, WORDS.concat(SCRIPTS), 1, 1);
  const rest = pieces(random, WORDS.concat(MARKS, SCRIPTS), 2, 9, " ");
  return `${lead} ${rest}`.replace(/\s+/g, " ").trim();
}

describe.each([1, 2, 3])("typed text survives the editor, storage and the page (seed %i)", (seed) => {
  it("keeps every typed character", { timeout: 30_000 }, () => {
    const random = seededRandom(seed);
    const failures: string[] = [];
    for (let index = 0; index < 150; index += 1) {
      const text = sentence(random);
      const saved = plainAmpersands(typed(text).getMarkdown());
      const again = reopened(saved).getText().replace(/\s+/g, " ").trim();
      const shown = page(saved).replace(/\s+/g, " ").trim();
      if (again !== text)
        failures.push(
          `seed ${seed} #${index} reopened: ${JSON.stringify(text)} -> ${JSON.stringify(again)} (saved ${JSON.stringify(saved)})`,
        );
      else if (shown !== text)
        failures.push(
          `seed ${seed} #${index} shown: ${JSON.stringify(text)} -> ${JSON.stringify(shown)} (saved ${JSON.stringify(saved)})`,
        );
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it("stores a typed ampersand as an ampersand", () => {
    const random = seededRandom(seed * 100);
    for (let index = 0; index < 60; index += 1) {
      const text = `${pieces(random, ["R&D", "Q&A", "AT&T", "Tom & Jerry"], 1, 3, " ")} ${pieces(random, SCRIPTS, 1, 2, " ")}`;
      expect(plainAmpersands(typed(text).getMarkdown())).not.toContain("&amp;");
    }
  });
});
