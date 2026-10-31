// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { plainAmpersands, restoreTemplateMarkdown } from "../../assets/ts/components/markdown-editor/template-markdown";
import { TemplateHighlighting } from "../../assets/ts/components/markdown-editor/template-highlighting";
import { Editor } from "@tiptap/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { editorExtensions } from "../../assets/ts/components/markdown-editor/editor-extensions";
import { insertEditorBlock, moveEditorBlock } from "../../assets/ts/components/markdown-editor/editor-blocks";
import { Markdown } from "../../assets/ts/ui/Markdown";
import { markdownMediaInsertSchema } from "../../assets/shared/schemas/markdown-editor";
import { codeLanguageItems } from "../../assets/ts/components/markdown-editor/code-language-menu";
import { markdownVideoEmbed } from "../../assets/shared/markdown-media";

const editors: Editor[] = [];
const containers: HTMLElement[] = [];
function editor(content: string) {
  const instance = new Editor({ injectCSS: false, extensions: editorExtensions(), content, contentType: "markdown" });
  editors.push(instance);
  return instance;
}
function publicContent(markdown: string) {
  const root = document.createElement("div");
  containers.push(root);
  void act(() => render(<Markdown markdown={markdown} />, root));
  return root;
}
afterEach(() => {
  editors.splice(0).forEach((instance) => instance.destroy());
  containers.splice(0).forEach((root) => {
    void act(() => render(null, root));
  });
});

describe("visual Markdown round trips", () => {
  it("keeps biography titles as paragraphs rather than numbered lists", () => {
    const source =
      "Ir. Dr. Example has served as an engineer.\n\nFor the past 26 years, he has developed policy.\n\nDr. Example has a doctorate.";
    const instance = editor(source);
    expect(instance.view.dom.querySelector("ol")).toBeNull();
    expect(instance.view.dom.querySelectorAll("p")).toHaveLength(3);
    expect(instance.view.dom.textContent).toContain("Ir. Dr. Example");
    expect(editor(instance.getMarkdown()).getJSON()).toEqual(instance.getJSON());
  });

  it("preserves numeric ordered lists through Markdown round trips", () => {
    const instance = editor("3. Review the certificate.\n4. Check the issuer.");
    expect(instance.view.dom.querySelector("ol")?.start).toBe(3);
    expect(instance.view.dom.querySelectorAll("ol > li")).toHaveLength(2);
    expect(editor(instance.getMarkdown()).getJSON()).toEqual(instance.getJSON());
  });
  it("keeps nested lists, formatting, image descriptions, tables and videos in the public result", () => {
    const source =
      "## Our work\n\n**Strong** and *clear* with a [link](https://example.test).\n\n- First\n  - Nested\n- Second\n\n> A callout.\n\n![Accessible description](https://example.test/image.png)\n\n| Product | Status |\n| --- | --- |\n| Certificates | Ready |\n\nhttps://www.youtube.com/watch?v=HGoZW7MCF60";
    const first = editor(source);
    const saved = first.getMarkdown();
    const reopened = editor(saved);
    expect(reopened.getJSON()).toEqual(first.getJSON());
    const page = publicContent(saved);
    expect(page.querySelector("strong")?.textContent).toBe("Strong");
    expect(page.querySelector("ul ul li")?.textContent).toBe("Nested");
    expect(page.querySelector("img")?.alt).toBe("Accessible description");
    expect(page.querySelector("th")?.textContent).toBe("Product");
    expect(page.querySelector("td")?.textContent).toBe("Certificates");
    expect(page.querySelector("iframe")?.src).toBe("https://www.youtube.com/embed/HGoZW7MCF60");
    expect(first.view.dom.querySelector("[style]")).toBeNull();
    expect(saved).not.toMatch(/<(?:table|iframe|img|div)/);
  });

  it("edits an aside's heading and body and preserves them through save, reopen, and publication", () => {
    const source =
      "Before.\n\n:::aside\n### Context\n\nRead the [guide](https://example.test/guide).\n\n- First\n  - Nested\n\n**Supporting** material.\n:::\n\nAfter.";
    const first = editor(source);
    expect(first.state.doc.child(1).type.name).toBe("aside");
    expect(first.view.dom.querySelector("aside h3")?.textContent).toBe("Context");
    let headingPosition = 0;
    first.state.doc.descendants((node, position) => {
      if (node.type.name === "heading") headingPosition = position + 1;
    });
    first.commands.insertContentAt(
      { from: headingPosition, to: headingPosition + "Context".length },
      "Updated context",
    );
    let bodyPosition = 0;
    first.state.doc.descendants((node, position) => {
      if (node.type.name === "paragraph" && node.textContent === "Supporting material.")
        bodyPosition = position + node.nodeSize - 1;
    });
    first.commands.insertContentAt(bodyPosition, " Added in the visual editor.");
    const saved = first.getMarkdown();
    const reopened = editor(saved);
    expect(reopened.getJSON()).toEqual(first.getJSON());
    const page = publicContent(saved);
    expect(page.querySelector("aside")?.textContent).toContain("Added in the visual editor.");
    expect(page.querySelector("aside h3")?.textContent).toBe("Updated context");
    expect(page.querySelector("aside ul ul li")?.textContent).toBe("Nested");
    expect(page.querySelector("aside a")?.getAttribute("href")).toBe("https://example.test/guide");
    expect(page.querySelector("aside strong")?.textContent).toBe("Supporting");
    expect(page.querySelector("[role=alert], [role=status]")).toBeNull();
    expect(saved).toContain(":::aside");
    expect(saved).not.toContain("<aside");
  });

  it("preserves nested asides and literal directive examples on another edit", () => {
    const instance = editor(
      "::::aside\n### Outer\n\n:::aside\nNested text.\n:::\n\n```markdown\n:::aside\nExample.\n:::\n```\n::::",
    );
    const saved = instance.getMarkdown();
    expect(editor(saved).getJSON()).toEqual(instance.getJSON());
    const page = publicContent(saved);
    expect(page.querySelectorAll("aside")).toHaveLength(2);
    expect(page.querySelector("pre code")?.textContent).toContain(":::aside");
  });

  it("keeps table content editable inside the shared scrolling table presentation", () => {
    const instance = editor("| Material | Audience |\n| --- | --- |\n| Methodology | Contributors |");
    expect(instance.view.dom.querySelector(".pk-table__scroll table.pk-table")).not.toBeNull();
    let cellPosition = 0;
    instance.state.doc.descendants((node, position) => {
      if (node.isText && node.text === "Contributors") cellPosition = position;
    });
    instance.commands.insertContentAt({ from: cellPosition, to: cellPosition + "Contributors".length }, "Reviewers");
    const saved = instance.getMarkdown();
    expect(editor(saved).getJSON()).toEqual(instance.getJSON());
    const page = publicContent(saved);
    expect(page.querySelector(".pk-table__scroll table.pk-table td:last-child")?.textContent).toBe("Reviewers");
    expect(saved).not.toContain("<table");
  });

  it("inserts a page block after the selected table instead of losing it inside a Markdown cell", () => {
    const instance = editor("| Capability | Status |\n| --- | --- |\n| Certificates | Ready |");
    insertEditorBlock(instance, "callout", 4);
    expect(instance.view.dom.querySelector("td blockquote, th blockquote")).toBeNull();
    expect(instance.view.dom.querySelector("blockquote")?.textContent).toBe("Write your callout here.");
    const saved = instance.getMarkdown();
    const page = publicContent(saved);
    expect(page.querySelector("td")?.textContent).toBe("Certificates");
    expect(page.querySelector("blockquote")?.textContent).toBe("Write your callout here.");
  });

  it("moves a whole selected block and can undo it without losing content", () => {
    const instance = editor("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
    instance.commands.setTextSelection(instance.state.doc.child(0).nodeSize + 1);
    expect(moveEditorBlock(instance, -1)).toBe(true);
    expect(instance.getMarkdown()).toBe("Second paragraph.\n\nFirst paragraph.\n\nThird paragraph.");
    instance.commands.undo();
    expect(instance.getMarkdown()).toBe("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
    instance.commands.setTextSelection(1);
    expect(moveEditorBlock(instance, -1)).toBe(false);
  });
});

describe("author content remains data", () => {
  it("renders raw HTML as text and refuses executable link and image URLs", () => {
    const root = publicContent(
      "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Run](javascript:alert)\n\n![Image](data:text/html,bad)",
    );
    expect(root.querySelector("script, img, a, [onerror]")).toBeNull();
    expect(root.textContent).toContain("<script>");
  });
  it.each(["https://youtube.com.attacker.test/watch?v=abc", "javascript:alert(1)", "https://vimeo.com/12/extra"])(
    "does not embed %s",
    (url) => {
      expect(markdownVideoEmbed(url)).toBeNull();
    },
  );
  it("preserves standalone images when editor HTML is copied back into the editor", () => {
    const first = editor("![Accessible description](https://example.test/image.png)");
    const pasted = new Editor({ injectCSS: false, extensions: editorExtensions(), content: first.getHTML() });
    editors.push(pasted);
    expect(pasted.getJSON()).toEqual(first.getJSON());
  });

  it("requires an image description and reports media errors against their fields", () => {
    const result = markdownMediaInsertSchema.safeParse({
      kind: "image",
      url: "https://example.test/a.png",
      description: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["description"]);
    expect(
      markdownMediaInsertSchema.safeParse({ kind: "video", url: "https://example.test/video", description: "" })
        .success,
    ).toBe(false);
  });
});

describe("visual template highlighting", () => {
  it("preserves reusable template names while editing surrounding text", () => {
    const instance = editor("Hello {{firstName}}\n\n{{> about_pkic}}");
    instance.commands.insertContentAt(1, "Welcome. ");
    expect(restoreTemplateMarkdown(instance.getMarkdown())).toContain("{{> about_pkic}}");
  });

  it("preserves template comparisons and underscore variables without unescaping ordinary content", () => {
    const instance = editor("Literal_name <safe>\n\n{{#if user_name}}Hello {{user_name}}{{/if}}\n\n{{> about_pkic}}");
    const saved = restoreTemplateMarkdown(instance.getMarkdown());
    expect(saved).toContain("Literal\\_name &lt;safe&gt;");
    expect(saved).toContain("{{#if user_name}}Hello {{user_name}}{{/if}}");
    expect(saved).toContain("{{> about_pkic}}");
    expect(restoreTemplateMarkdown(editor(saved).getMarkdown())).toBe(saved);
  });

  it("saves a typed ampersand as itself, leaving code and deliberate entities alone", () => {
    const instance = editor("Q");
    instance.commands.insertContentAt(2, "&A at R&D");
    expect(instance.getMarkdown()).toContain("&amp;");
    expect(plainAmpersands(instance.getMarkdown())).toBe("Q&A at R&D");
    expect(plainAmpersands("`a &amp;&amp; b` and &amp;lt; and &amp;")).toBe("`a &amp;&amp; b` and &amp;lt; and &");
  });

  it("stores a typed < and > as themselves, with a backslash only where Markdown would read them as syntax", () => {
    expect(plainAmpersands("a &lt; b &gt; c &lt;3")).toBe("a < b > c <3");
    expect(plainAmpersands("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("\\<script>alert(1)\\</script>");
    expect(plainAmpersands("&gt; not a quote\n&gt; still not")).toBe("\\> not a quote\n\\> still not");
    expect(plainAmpersands("`a &lt; b` and &amp;lt;")).toBe("`a &lt; b` and &amp;lt;");
    const host = document.createElement("div");
    render(<Markdown markdown={"x < y > z and \\<b>bold\\</b>"} />, host);
    expect(host.textContent).toBe("x < y > z and <b>bold</b>");
    expect(host.querySelector("b")).toBeNull();
  });

  it("reads the ampersand the editor encodes as the character it stands for", () => {
    const host = document.createElement("div");
    render(<Markdown markdown={"R&amp;D and **Q&amp;A** &amp;lt; `a &amp; b`"} />, host);
    expect(host.textContent).toBe("R&D and Q&A &lt; a &amp; b");
  });

  it("highlights nested conditions and variables without serializing decorations", () => {
    const content =
      "{{#if hasBio}}\n\nHello {{firstName}}.\n\n{{#unless hasHeadshot}}Upload a photo.{{/unless}}\n\n{{/if}}";
    const instance = new Editor({
      injectCSS: false,
      extensions: [...editorExtensions(), TemplateHighlighting],
      content,
      contentType: "markdown",
    });
    editors.push(instance);
    expect(instance.view.dom.querySelector(".adm-template-token-var")?.textContent).toBe("{{firstName}}");
    expect(instance.view.dom.querySelectorAll(".adm-template-token-depth-0")).toHaveLength(2);
    expect(instance.view.dom.querySelectorAll(".adm-template-token-depth-1")).toHaveLength(2);
    expect(instance.getMarkdown()).toBe(content);
    expect(instance.getHTML()).not.toContain("adm-template-token");
  });
});

it("changes fenced-code languages without changing code and preserves unknown source languages", () => {
  const instance = editor("```custom-lang\nconst answer = 42;\n```");
  instance.commands.setTextSelection(2);
  expect(codeLanguageItems(instance).find((item) => item.checked)?.label).toBe("custom-lang");
  codeLanguageItems(instance).find((item) => item.id === "code-language-yaml")!.onSelect!();
  expect(instance.state.doc.textContent).toBe("const answer = 42;");
  expect(instance.getMarkdown()).toContain("```yaml\n");
  expect(editor(instance.getMarkdown()).getJSON()).toEqual(instance.getJSON());
  codeLanguageItems(instance).find((item) => item.id === "code-plain")!.onSelect!();
  expect(instance.getMarkdown()).not.toContain("```yaml");
  expect(instance.state.doc.textContent).toBe("const answer = 42;");
});

it("keeps an authored plain language distinct from the Plain text menu choice", () => {
  const instance = editor("```plain\nPreserve this text.\n```");
  instance.commands.setTextSelection(2);
  const choices = codeLanguageItems(instance);
  expect(new Set(choices.map((item) => item.id)).size).toBe(choices.length);
  expect(choices.find((item) => item.checked)?.id).toBe("code-language-plain");
  choices.find((item) => item.id === "code-plain")!.onSelect!();
  expect(instance.getMarkdown()).not.toContain("```plain");
  expect(instance.state.doc.textContent).toBe("Preserve this text.");
});
