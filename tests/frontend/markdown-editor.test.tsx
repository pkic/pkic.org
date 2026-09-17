// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TemplateHighlighting } from "../../assets/ts/components/markdown-editor/template-highlighting";
import { Editor } from "@tiptap/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { editorExtensions } from "../../assets/ts/components/markdown-editor/editor-extensions";
import { insertEditorBlock, moveEditorBlock } from "../../assets/ts/components/markdown-editor/editor-blocks";
import { Markdown } from "../../assets/ts/components/Markdown";
import { markdownMediaInsertSchema } from "../../assets/shared/schemas/markdown-editor";
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
