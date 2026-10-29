// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "../../assets/ts/components/markdown-editor/editor-extensions";
import { editorContextActions } from "../../assets/ts/components/markdown-editor/editor-context-actions";
import { contentActionsExample } from "../../assets/ts/ui/preview/content-actions-example";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
function open(content: string) {
  const editor = new Editor({ extensions: editorExtensions(), content, contentType: "markdown" });
  editors.push(editor);
  return editor;
}
const options = () => ({ formatting: [], editLayout: vi.fn(), editMedia: vi.fn() });

it("exposes the selected button and its owning card without modifying its text selection", () => {
  const editor = open(contentActionsExample);
  let position = 0;
  editor.state.doc.descendants((node, offset) => {
    if (node.isText && node.text === "Explore working groups") position = offset;
  });
  editor.commands.setTextSelection({ from: position + 1, to: position + 5 });
  const selection = editor.state.selection.toJSON();
  const handlers = options();
  const actions = editorContextActions(editor, handlers);
  expect(actions.some((action) => action.id === "edit-button")).toBe(true);
  expect(actions.some((action) => action.id === "edit-layout")).toBe(true);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  actions.find((action) => action.id === "edit-button")!.onSelect!();
  expect(handlers.editMedia).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "button", initialValue: { url: "/wg/", description: "Explore working groups" } }),
  );
});

it("uses the selected table commands and omits unrelated card controls", () => {
  const editor = open("| Name | Value |\n| --- | --- |\n| First | One |");
  editor.commands.setTextSelection(4);
  const actions = editorContextActions(editor, options());
  expect(actions.some((action) => action.id === "edit-layout")).toBe(false);
  actions.find((action) => action.label === "Add row")!.onSelect!();
  expect(editor.state.doc.firstChild!.childCount).toBe(3);
});

it("changes the selected code language through the shared context commands", () => {
  const editor = open('```json\n{ "enabled": true }\n```');
  editor.commands.setTextSelection(2);
  const language = editorContextActions(editor, options()).find((action) => action.id === "code-language")!;
  expect(language.children!.find((action) => action.checked)?.label).toBe("JSON");
  language.children!.find((action) => action.label === "YAML")!.onSelect!();
  expect(editor.getMarkdown()).toContain("```yaml");
  expect(editor.state.doc.textContent).toBe('{ "enabled": true }');
});
