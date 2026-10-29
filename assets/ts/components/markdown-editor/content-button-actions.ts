import type { Editor } from "@tiptap/core";
import type { MenuItem } from "../../ui/Menu";
import type { EditorMediaDraft } from "./EditorMediaInsertion";
import { contentButtonVariantSchema } from "../../../shared/schemas/content-layout";

export function contentButtonActions(editor: Editor, onEdit: (draft: EditorMediaDraft) => void): MenuItem[] {
  const selection = editor.state.selection.$from;
  let depth = selection.depth;
  while (depth > 0 && selection.node(depth).type.name !== "button") depth--;
  if (!depth) return [];
  const node = selection.node(depth),
    position = selection.before(depth);
  let href = "";
  node.descendants((child) => {
    const link = child.marks.find((mark) => mark.type.name === "link");
    if (link) href = link.attrs.href;
  });
  return [
    {
      id: "edit-button",
      label: "Edit button",
      onSelect: () =>
        onEdit({
          kind: "button",
          position,
          replaceTo: position + node.nodeSize,
          initialValue: { url: href, description: node.textContent },
        }),
    },
    {
      id: "button-style",
      label: "Button style",
      children: contentButtonVariantSchema.options.map((variant) => ({
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
      })),
    },
  ];
}
