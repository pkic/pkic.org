import type { Editor } from "@tiptap/core";
import {
  markdownBentoPresets,
  markdownLayoutChoiceSchema,
  type MarkdownLayoutChoice,
} from "../../../shared/schemas/markdown-layout";
import { insertEditorBlock } from "./editor-blocks";

/** The nearest authored layout owns editing; nested card text never selects an unrelated outer grid. */
export function selectedEditorLayout(editor: Editor) {
  const selection = editor.state.selection.$from;
  for (let depth = selection.depth; depth > 0; depth--) {
    const node = selection.node(depth);
    if (["columns", "grid", "cards"].includes(node.type.name)) return { node, position: selection.before(depth) };
  }
  return null;
}

/** Apply validated choices without dropping existing item contents when changing column count or arrangement. */
export function applyEditorLayout(editor: Editor, input: MarkdownLayoutChoice, editing: boolean): void {
  const choice = markdownLayoutChoiceSchema.parse(input);
  const target = editing ? selectedEditorLayout(editor) : null;
  if (!target) {
    if (choice.kind === "columns" && !editor.isActive("table")) {
      editor.chain().focus().toggleWrap("columns", { count: choice.count }).run();
    } else insertEditorBlock(editor, choice.kind, editor.state.selection.from, choice);
    return;
  }
  if (choice.kind === "table") return;
  const preset = choice.kind === "bento" ? markdownBentoPresets[choice.preset] : null;
  const compatible =
    target.node.type.name === choice.kind || (target.node.type.name === "cards" && choice.kind === "bento");
  if (!compatible) return;
  const transaction = editor.state.tr.setNodeMarkup(target.position, undefined, {
    ...target.node.attrs,
    count: preset ? preset.count : choice.kind === "bento" ? null : choice.count,
    ...(target.node.type.name === "cards" ? { layout: preset ? "bento" : "grid" } : {}),
  });
  if (target.node.type.name === "cards")
    target.node.forEach((child, offset, index) => {
      transaction.setNodeMarkup(target.position + 1 + offset, undefined, {
        ...child.attrs,
        span: preset && index === 0 ? preset.span : null,
        rows: preset && index === 0 ? preset.rows : null,
      });
    });
  editor.view.dispatch(transaction);
  editor.commands.focus();
}
