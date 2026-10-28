import type { Editor } from "@tiptap/core";
import { Button } from "../../ui/Button";

/** Table operations stay with the selected table and share the editor's disabled state. */
export function TableEditingControls({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const actions = [
    { label: "Add row", run: () => editor.chain().focus().addRowAfter().run() },
    { label: "Add column", run: () => editor.chain().focus().addColumnAfter().run() },
    { label: "Delete row", run: () => editor.chain().focus().deleteRow().run() },
    { label: "Delete column", run: () => editor.chain().focus().deleteColumn().run() },
    { label: "Remove table", run: () => editor.chain().focus().deleteTable().run() },
  ];
  return (
    <div class="pk-markdown-editor__toolbar" data-density="compact" role="group" aria-label="Table editing">
      {actions.map((action) => (
        <Button key={action.label} variant="ghost" disabled={disabled} onClick={action.run}>
          {action.label}
        </Button>
      ))}
    </div>
  );
}
