import type { Editor } from "@tiptap/core";
import type { MenuItem } from "../../ui/Menu";
import type { EditorMediaDraft } from "./EditorMediaInsertion";
import { codeBlockActions } from "./code-language-menu";
import { contentButtonActions } from "./content-button-actions";
import { contentLayoutActions } from "./content-layout-actions";
import { tableEditingActions } from "./table-editing-actions";
import { moveEditorBlock } from "./editor-blocks";

/** One contextual command list serves the toolbar button, pointer menu, and keyboard shortcut. */
export function editorContextActions(
  editor: Editor,
  {
    formatting,
    editLayout,
    editMedia,
    allowMove = true,
  }: {
    formatting: readonly MenuItem[];
    editLayout: () => void;
    editMedia: (draft: EditorMediaDraft) => void;
    allowMove?: boolean;
  },
): MenuItem[] {
  const actions = [
    ...contentButtonActions(editor, editMedia),
    ...codeBlockActions(editor),
    ...tableEditingActions(editor),
    ...contentLayoutActions(editor, editLayout),
  ];
  const { selection, doc } = editor.state;
  const image = doc.nodeAt(selection.from);
  if (image?.type.name === "image" || image?.type.name === "memberVideo")
    actions.unshift({
      id: image.type.name === "image" ? "edit-image" : "edit-video",
      label: image.type.name === "image" ? "Edit image" : "Edit video",
      onSelect: () =>
        editMedia({
          kind: image.type.name === "image" ? "image" : "video",
          position: selection.from,
          replaceTo: selection.from + image.nodeSize,
          initialValue: { url: String(image.attrs.src ?? image.attrs.url), description: String(image.attrs.alt ?? "") },
        }),
    });
  if (editor.isActive("link") && !editor.isActive("button"))
    actions.unshift({
      id: "edit-link",
      label: "Edit link",
      onSelect: () => {
        editor.chain().focus().extendMarkRange("link").run();
        const range = editor.state.selection;
        editMedia({
          kind: "link",
          position: range.from,
          replaceTo: range.to,
          initialValue: {
            url: String(editor.getAttributes("link").href),
            description: doc.textBetween(range.from, range.to),
          },
        });
      },
    });
  actions.push({
    id: "formatting",
    label: "Formatting and insertion",
    separatorBefore: actions.length > 0,
    children: formatting,
  });
  if (allowMove) {
    const position = selection.$from.depth ? selection.$from.before(1) : selection.from;
    const node = doc.nodeAt(position);
    actions.push(
      {
        id: "move-up",
        label: "Move block up",
        separatorBefore: true,
        disabled: position === 0,
        onSelect: () => {
          moveEditorBlock(editor, -1);
        },
      },
      {
        id: "move-down",
        label: "Move block down",
        disabled: !node || position + node.nodeSize >= doc.content.size,
        onSelect: () => {
          moveEditorBlock(editor, 1);
        },
      },
    );
  }
  return actions;
}
