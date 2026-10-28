import type { Editor } from "@tiptap/core";
import type { MenuItem } from "../../ui/Menu";

/** Table operations stay with the selected table and share the editor's disabled state. */
export function tableEditingActions(editor: Editor): MenuItem[] {
  if (!editor.isActive("table")) return [];
  const actions = [
    { label: "Add row", run: () => editor.chain().focus().addRowAfter().run() },
    { label: "Add column", run: () => editor.chain().focus().addColumnAfter().run() },
    { label: "Delete row", run: () => editor.chain().focus().deleteRow().run() },
    { label: "Delete column", run: () => editor.chain().focus().deleteColumn().run() },
    { label: "Remove table", run: () => editor.chain().focus().deleteTable().run() },
  ];
  return actions.map((action) => ({ id: `table-${action.label}`, label: action.label, onSelect: action.run }));
}
