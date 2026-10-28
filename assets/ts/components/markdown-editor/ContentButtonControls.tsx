import type { Editor } from "@tiptap/core";
import { contentButtonVariantSchema } from "../../../shared/schemas/content-layout";
import { Button } from "../../ui/Button";
import { Menu } from "../../ui/Menu";

export function ContentButtonControls({
  editor,
  onEdit,
}: {
  editor: Editor;
  onEdit: (button: { position: number; replaceTo: number; initialValue: { url: string; description: string } }) => void;
}) {
  const selection = editor.state.selection.$from;
  let depth = selection.depth;
  while (depth > 0 && selection.node(depth).type.name !== "button") depth--;
  if (!depth) return null;
  const node = selection.node(depth),
    position = selection.before(depth);
  let href = "";
  node.descendants((child) => {
    const link = child.marks.find((mark) => mark.type.name === "link");
    if (link) href = link.attrs.href;
  });
  return (
    <div class="pk-markdown-editor__toolbar" data-density="compact" role="group" aria-label="Button editing">
      <Button
        variant="ghost"
        onClick={() =>
          onEdit({
            position,
            replaceTo: position + node.nodeSize,
            initialValue: { url: href, description: node.textContent },
          })
        }
      >
        Edit button
      </Button>
      <Menu
        label="Button style"
        items={contentButtonVariantSchema.options.map((variant) => ({
          id: variant,
          label:
            variant === "ghost"
              ? "Quiet"
              : variant === "link"
                ? "Text link"
                : variant === "primary"
                  ? "Primary"
                  : "Secondary",
          checked: (node.attrs.variant ?? "primary") === variant,
          onSelect: () => editor.chain().focus().updateAttributes("button", { variant }).run(),
        }))}
      />
    </div>
  );
}
