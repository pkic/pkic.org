import type { Editor, JSONContent } from "@tiptap/core";

export const EDITOR_BLOCKS = ["callout", "table", "image", "video"] as const;
export type EditorBlock = (typeof EDITOR_BLOCKS)[number];
export const BLOCK_TRANSFER_TYPE = "application/x-pkic-markdown-block";

/** Page blocks stay outside table cells and existing callouts. Markdown tables cannot store nested layouts. */
export function editorBlockPosition(editor: Editor, position: number): number {
  const resolved = editor.state.doc.resolve(position);
  return resolved.depth > 1 ? resolved.after(1) : position;
}

export function insertEditorBlock(editor: Editor, kind: Exclude<EditorBlock, "image" | "video">, position: number) {
  position = editorBlockPosition(editor, position);
  editor.commands.setTextSelection(position);
  if (kind === "table") {
    editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
    return;
  }
  const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
  const content: JSONContent[] = [
    { type: "blockquote", content: [paragraph("Write your callout here.")] },
    { type: "paragraph" },
  ];
  editor.chain().focus().insertContentAt(position, content).run();
}

/** Move whole top-level blocks; the buttons also make reordering available without dragging. */
export function moveEditorBlock(editor: Editor, direction: -1 | 1): boolean {
  const { selection, doc } = editor.state;
  const position = selection.$from.depth ? selection.$from.before(1) : selection.from;
  const blocks: { position: number; node: typeof doc }[] = [];
  doc.forEach((node, offset) => blocks.push({ node, position: offset }));
  const index = blocks.findIndex((block) => block.position === position);
  const target = blocks[index + direction];
  const current = blocks[index];
  if (!target || !current) return false;
  const transaction = editor.state.tr.delete(current.position, current.position + current.node.nodeSize);
  const destination = direction < 0 ? target.position : target.position + target.node.nodeSize - current.node.nodeSize;
  transaction.insert(destination, current.node);
  editor.view.dispatch(transaction);
  editor.commands.setTextSelection(destination + (current.node.isTextblock ? 1 : 0));
  editor.commands.focus();
  return true;
}
