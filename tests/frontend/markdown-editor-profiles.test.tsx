// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { editorExtensions } from "../../assets/ts/components/markdown-editor/editor-extensions";
import { MarkdownEditor } from "../../assets/ts/components/markdown-editor/MarkdownEditor";

const editors: Editor[] = [];
const root = document.createElement("div");
afterEach(async () => {
  editors.splice(0).forEach((editor) => editor.destroy());
  await act(() => render(null, root));
  root.remove();
});
function basic(content: string, contentType: "markdown" | "html" = "markdown") {
  const editor = new Editor({ extensions: editorExtensions("basic"), content, contentType });
  editors.push(editor);
  return editor;
}
it("activates only basic formatting and lists, independently of canvas size", () => {
  const editor = basic("**Bold** and *italic* with a [link](https://example.test).\n\n- A list item");
  expect(editor.view.dom.querySelector("strong")?.textContent).toBe("Bold");
  expect(editor.view.dom.querySelector("em")?.textContent).toBe("italic");
  expect(editor.view.dom.querySelector("a")?.textContent).toBe("link");
  expect(editor.view.dom.querySelector("li")?.textContent).toBe("A list item");
  for (const name of [
    "heading",
    "blockquote",
    "codeBlock",
    "table",
    "image",
    "memberVideo",
    "aside",
    "cards",
    "button",
  ])
    expect(editor.schema.nodes[name]).toBeUndefined();
  expect(editor.schema.marks.code).toBeUndefined();
  expect(editor.schema.marks.strike).toBeUndefined();
  expect(editor.commands.setHeading).toBeUndefined();
  expect(editor.commands.insertTable).toBeUndefined();
});
it("preserves unsupported existing syntax as visible literal text through saving and reopening", () => {
  const source =
    "## A title\n\n![A logo](/logo.svg)\n\n```js\nconst answer = 42;\n```\n\n| A | B |\n| --- | --- |\n| One | Two |";
  const editor = basic(source);
  expect(editor.state.doc.textContent).toContain("A title");
  expect(editor.state.doc.textContent).toContain("/logo.svg");
  expect(editor.state.doc.textContent).toContain("const answer = 42;");
  expect(editor.state.doc.textContent).toContain("One");
  expect(basic(editor.getMarkdown()).getJSON()).toEqual(editor.getJSON());
});
it("keeps pasted text and basic formatting while omitting unsupported structures", () => {
  const editor = basic(
    "<h2>A title</h2><p><strong>Bold</strong><img src='/logo.svg'></p><table><tr><td>Cell text</td></tr></table>",
    "html",
  );
  expect(editor.state.doc.textContent).toContain("A title");
  expect(editor.state.doc.textContent).toContain("Cell text");
  expect(editor.view.dom.querySelector("strong")?.textContent).toBe("Bold");
  expect(editor.view.dom.querySelector("h2, img, table")).toBeNull();
});
it.each(["full", "compact"] as const)("defaults %s sized fields to the basic toolbar", async (variant) => {
  document.body.append(root);
  await act(async () =>
    render(
      <MarkdownEditor
        variant={variant}
        id="bio"
        name="bio"
        label="About you"
        initialValue="Biography"
        onChange={() => {}}
      />,
      root,
    ),
  );
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('[aria-label="Bold"]')?.disabled).toBe(false));
  for (const name of ["Heading", "Supporting note", "Insert layout", "Code", "Image", "Video", "Table"])
    expect(root.querySelector(`[aria-label="${name}"]`)).toBeNull();
  expect(root.querySelector('[aria-label="Italic"]')).not.toBeNull();
  await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="Link"]')!.click());
  await vi.waitFor(() => expect(document.body.querySelector("dialog")).not.toBeNull());
  expect(document.body.textContent).toContain("Insert link");
});

it("activates content capabilities explicitly even in a compact field", async () => {
  document.body.append(root);
  await act(async () =>
    render(
      <MarkdownEditor
        id="body"
        name="body"
        label="Body"
        variant="compact"
        profile="content"
        initialValue="Page body"
        onChange={() => {}}
      />,
      root,
    ),
  );
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('[aria-label="Heading"]')?.disabled).toBe(false));
  expect(root.querySelector('[aria-label="Insert layout"]')).not.toBeNull();
  expect(root.querySelector('[aria-label="Table"]')).not.toBeNull();
});
