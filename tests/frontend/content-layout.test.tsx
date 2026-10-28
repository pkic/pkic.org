// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { renderToString } from "preact-render-to-string";
import { editorExtensions } from "../../assets/ts/components/markdown-editor/editor-extensions";
import { insertEditorBlock } from "../../assets/ts/components/markdown-editor/editor-blocks";
import {
  contentBentoExample,
  contentColumnExample,
  contentGridExample,
  contentLayoutExample,
} from "../../assets/ts/ui/preview/content-layout-example";
import { Markdown } from "../../assets/ts/ui/Markdown";
import { markdownContentSchema } from "../../assets/shared/schemas/markdown-content";
import { contentIconSchema } from "../../assets/shared/schemas/content-layout";
import { applyEditorLayout } from "../../assets/ts/components/markdown-editor/editor-layout-editing";
import { markdownLayoutChoiceSchema } from "../../assets/shared/schemas/markdown-layout";
import { contentActionsExample } from "../../assets/ts/ui/preview/content-actions-example";
import { contentIconMarkup } from "../../assets/ts/site/ContentIcon";

const instances: Editor[] = [];
function open(source: string) {
  const editor = new Editor({
    injectCSS: false,
    extensions: editorExtensions(),
    content: source,
    contentType: "markdown",
  });
  instances.push(editor);
  return editor;
}
function published(source: string) {
  const root = document.createElement("div");
  root.innerHTML = renderToString(<Markdown markdown={source} layout="reading" />);
  return root;
}
afterEach(() => instances.splice(0).forEach((editor) => editor.destroy()));

it("edits one continuous Markdown body and preserves column count and width through saving and reopening", () => {
  const editor = open(contentColumnExample);
  const body = editor.view.dom.querySelector(".pk-content-columns__body")!;
  expect(body.querySelectorAll("p")).toHaveLength(6);
  expect(body.querySelectorAll(".pk-content-column")).toHaveLength(0);
  let position = 0;
  editor.state.doc.descendants((node, offset) => {
    if (node.isText && node.text === "Start with a practical question") position = offset;
  });
  editor.commands.insertContentAt(
    { from: position, to: position + "Start with a practical question".length },
    "A shared practical question",
  );
  editor.commands.updateAttributes("columns", { count: "4", width: "18rem" });
  const saved = editor.getMarkdown();
  expect(saved).toContain("columns count=4 width=18rem");
  expect(saved).toContain("A shared practical question");
  expect(saved).not.toContain(":::column\n");
  expect(open(saved).getJSON()).toEqual(editor.getJSON());
  expect(
    published(saved).querySelector(
      '.pk-content-columns[data-count="4"][data-width="18rem"] > .pk-content-columns__body p',
    ),
  ).not.toBeNull();
});

it("preserves bento spans, shared icons, accessible logo contents, and card defaults as editable Markdown", () => {
  const editor = open(contentBentoExample);
  const featured = editor.view.dom.querySelector('.pk-content-card[data-span="2"][data-rows="2"]')!;
  expect(featured.querySelector(".pk-content-card__icon svg")).not.toBeNull();
  const saved = editor.getMarkdown();
  expect(saved).toContain("cards count=3 layout=bento");
  expect(saved).toContain("span=2 rows=2 icon=shield-check");
  expect(saved).toContain("![PKI Consortium](/img/logo-color.svg)");
  expect(saved).not.toContain("<svg");
  expect(open(saved).getJSON()).toEqual(editor.getJSON());
  const result = published(saved);
  expect(result.querySelectorAll(".pk-content-cards > .pk-content-card")).toHaveLength(3);
  expect(result.querySelectorAll('.pk-content-card__icon[aria-hidden="true"] svg')).toHaveLength(2);
  expect(result.querySelector('.pk-content-card[data-media="logo"] img')?.getAttribute("alt")).toBe("PKI Consortium");
  for (const name of contentIconSchema.options) expect(contentIconMarkup(name)).toContain("<svg");
});

it("keeps independent grid items and per-card overrides through actual editing and reopening", () => {
  const editor = open(contentGridExample);
  expect(editor.view.dom.querySelectorAll(".pk-content-grid > .pk-content-item")).toHaveLength(2);
  let position = 0;
  editor.state.doc.descendants((node, offset) => {
    if (node.isText && node.text === "Reference library") position = offset;
  });
  editor.commands.insertContentAt({ from: position, to: position + "Reference library".length }, "Evidence library");
  const saved = editor.getMarkdown();
  expect(saved).toContain("Evidence library");
  expect(open(saved).getJSON()).toEqual(editor.getJSON());
  expect(published(saved).querySelector('.pk-content-card[data-variant="default"]')?.textContent).toContain(
    "Evidence library",
  );
});

it("inserts distinct flowing, grid, card, and bento blocks from the editor controls", () => {
  for (const kind of ["columns", "grid", "cards", "bento"] as const) {
    const editor = open("");
    insertEditorBlock(editor, kind, 0);
    if (kind === "columns") {
      expect(editor.view.dom.querySelectorAll(".pk-content-columns__body > p")).toHaveLength(1);
      expect(editor.getMarkdown()).toContain("columns count=2");
    } else
      expect(editor.view.dom.querySelector(`.pk-content-${kind === "bento" ? "cards" : kind}`)?.children).toHaveLength(
        3,
      );
    expect(open(editor.getMarkdown()).getJSON()).toEqual(editor.getJSON());
  }
});

it("validates bounded layout attributes and structure without interpreting literal code examples", () => {
  const schema = markdownContentSchema(20000);
  expect(schema.safeParse(contentLayoutExample).success).toBe(true);
  for (const source of [
    ":::cards variant=custom\n:::card\nText\n:::\n:::",
    ":::columns count=0\nText\n:::",
    ":::columns width=100px\nText\n:::",
    ":::columns icon=users\nText\n:::",
    ":::cards\nUnstructured text\n:::",
    ":::grid\n:::card\nWrong child\n:::\n:::",
    ":::card icon=missing\nText\n:::",
    ":::card span=99\nText\n:::",
    ":::cards\n:::card\nUnclosed",
    ":::columns columns=2\nText\n:::",
  ])
    expect(schema.safeParse(source).success).toBe(false);
  for (const count of ["2", "4"])
    expect(schema.safeParse(`:::columns count=${count}\nPlain paragraphs.\n:::`).success).toBe(true);
  expect(schema.safeParse("```markdown\n:::cards variant=custom\nExample\n```").success).toBe(true);
});

it("preserves nested asides, links, and literal examples inside a card", () => {
  const source =
    ":::::cards count=3\n::::card variant=accent\n### Context\n\n:::aside\nRead the [guide](https://example.org/guide/).\n:::\n\n```markdown\n:::cards variant=custom\nLiteral example\n```\n::::\n:::::";
  const editor = open(source);
  const saved = editor.getMarkdown();
  expect(markdownContentSchema(20000).safeParse(saved).success).toBe(true);
  expect(open(saved).getJSON()).toEqual(editor.getJSON());
  const result = published(saved);
  expect(result.querySelector(".pk-content-card aside a")?.getAttribute("href")).toBe("https://example.org/guide/");
  expect(result.querySelector("pre")?.textContent).toContain(":::cards variant=custom");
});

it("wraps selected existing paragraphs in text columns without replacing their contents", () => {
  const editor = open("First paragraph.\n\nSecond paragraph.");
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  editor.commands.toggleWrap("columns", { count: "2" });
  expect(editor.state.doc.firstChild?.type.name).toBe("columns");
  expect(editor.state.doc.firstChild?.childCount).toBe(2);
  const saved = editor.getMarkdown();
  expect(saved).toContain("First paragraph.");
  expect(saved).toContain("Second paragraph.");
  expect(open(saved).getJSON()).toEqual(editor.getJSON());
  editor.commands.toggleWrap("columns");
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
});

it("keeps malformed container input renderable while the save contract refuses it", () => {
  for (const source of [
    ":::aside foo\nSupporting text.\n:::",
    ":::columns count=9\nArticle text.\n:::",
    ":::cards variant=custom\nCard text.\n:::",
    ":::card icon=missing\nCard text.\n:::",
  ]) {
    const editor = open(source);
    expect(editor.view.dom.textContent).toContain(source.split("\n")[0]);
    expect(published(source).textContent).toContain(source.split("\n")[0]);
    expect(markdownContentSchema(20000).safeParse(source).success).toBe(false);
  }
});

it("keeps invalid layout children editable as plain Markdown through splitting and reopening", () => {
  for (const [type, source] of [
    ["cards", "::::cards\nA paragraph to split.\n::::"],
    ["cards", "::::cards\n:::card variant=custom\nA paragraph to split.\n:::\n::::"],
    ["grid", "::::grid\n:::card\nA paragraph to split.\n:::\n::::"],
    ["columns", ":::::columns count=2\n::::cards\n:::card variant=custom\nA paragraph to split.\n:::\n::::\n:::::"],
  ]) {
    const editor = open(source);
    expect(editor.view.dom.querySelector(`.pk-content-${type}`), source).toBeNull();
    expect(() => editor.state.doc.check()).not.toThrow();
    let position = 0;
    editor.state.doc.descendants((node, offset) => {
      if (node.isText && node.text?.includes("to split")) position = offset + node.text.indexOf("to split");
    });
    expect(position).toBeGreaterThan(0);
    editor.commands.setTextSelection(position);
    expect(editor.commands.splitBlock()).toBe(true);
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(open(editor.getMarkdown()).getJSON()).toEqual(editor.getJSON());
    expect(markdownContentSchema(20000).safeParse(source).success).toBe(false);
  }
});

it("sizes new cards directly and preserves all content when changing count and bento arrangements", () => {
  const editor = open("Start here.");
  applyEditorLayout(editor, { kind: "cards", count: "3", rows: 2 }, false);
  const cards = () => editor.state.doc.firstChild!;
  expect(cards().type.name).toBe("cards");
  expect(cards().childCount).toBe(6);
  const contents = cards().textContent;
  applyEditorLayout(editor, { kind: "cards", count: "2" }, true);
  expect(cards().attrs.count).toBe("2");
  expect(cards().childCount).toBe(6);
  applyEditorLayout(editor, { kind: "bento", preset: "feature-left" }, true);
  expect(cards().firstChild!.attrs.rows).toBe("2");
  applyEditorLayout(editor, { kind: "bento", preset: "feature-top" }, true);
  expect(cards().attrs.count).toBe("2");
  expect(cards().firstChild!.attrs.rows).toBe("1");
  applyEditorLayout(editor, { kind: "cards", count: "auto" }, true);
  expect(cards().attrs.layout).toBe("grid");
  expect(cards().firstChild!.attrs.span).toBeNull();
  expect(cards().textContent).toBe(contents);
  expect(open(editor.getMarkdown()).getJSON()).toEqual(editor.getJSON());
});

it("wraps selected prose in the chosen text-column count and inserts tables at the selected size", () => {
  const editor = open("Selected prose.");
  editor.commands.selectAll();
  applyEditorLayout(editor, { kind: "columns", count: "4" }, false);
  expect(editor.state.doc.firstChild!.attrs.count).toBe("4");
  expect(editor.state.doc.textContent).toBe("Selected prose.");
  const table = open("");
  applyEditorLayout(table, { kind: "table", columns: 3, rows: 2 }, false);
  expect(table.state.doc.firstChild!.childCount).toBe(2);
  expect(table.state.doc.firstChild!.firstChild!.childCount).toBe(3);
  expect(markdownLayoutChoiceSchema.safeParse({ kind: "table", columns: 9, rows: 2 }).success).toBe(false);
});

it("never removes an existing columns layout when inserting another with the same count", () => {
  const editor = open(":::columns count=2\nKeep this text.\n:::");
  editor.commands.setTextSelection(3);
  applyEditorLayout(editor, { kind: "columns", count: "2" }, false);
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "columns") count++;
  });
  expect(count).toBe(2);
  expect(editor.state.doc.textContent).toBe("Keep this text.");
  expect(open(editor.getMarkdown()).getJSON()).toEqual(editor.getJSON());
});

it("preserves editable resource-card sections and shared button links through saving and reopening", () => {
  const editor = open(contentActionsExample);
  expect(editor.view.dom.querySelectorAll(".pk-content-card-header")).toHaveLength(3);
  expect(editor.view.dom.querySelectorAll(".pk-content-card-footer")).toHaveLength(3);
  expect(editor.view.dom.querySelectorAll(".pk-content-button")).toHaveLength(5);
  expect(open(editor.getMarkdown()).getJSON()).toEqual(editor.getJSON());
  expect(markdownContentSchema(30000).safeParse(editor.getMarkdown()).success).toBe(true);
  const result = published(editor.getMarkdown());
  expect(result.querySelectorAll("a.pk-content-button.pk-btn")).toHaveLength(5);
  expect(result.querySelector(".pk-content-button.pk-btn--secondary")?.getAttribute("href")).toBe("/sponsors/sponsor/");
});
