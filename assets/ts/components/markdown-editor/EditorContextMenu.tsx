import type { Editor } from "@tiptap/core";
import { useLayoutEffect, useRef } from "preact/hooks";
import { Menu, type MenuHandle, type MenuItem } from "../../ui/Menu";
import { buttonClasses } from "../../ui/button-classes";
import type { EditorMediaDraft } from "./EditorMediaInsertion";
import { editorContextActions } from "./editor-context-actions";

export function EditorContextMenu({
  editor,
  disabled,
  formatting,
  editLayout,
  editMedia,
  allowMove,
}: {
  editor: Editor;
  disabled: boolean;
  formatting: readonly MenuItem[];
  editLayout: () => void;
  editMedia: (draft: EditorMediaDraft) => void;
  allowMove: boolean;
}) {
  const menu = useRef<MenuHandle>(null);
  useLayoutEffect(() => {
    const canvas = editor.view.dom;
    let pointerType = "";
    const recordPointer = (event: PointerEvent) => {
      pointerType = event.pointerType;
    };
    function context(event: MouseEvent) {
      // Keep native text-selection/copy controls on touch and an explicit browser-menu escape on desktop.
      const pointer = "pointerType" in event && event.pointerType ? event.pointerType : pointerType;
      if (disabled || event.shiftKey || pointer === "touch") return;
      event.preventDefault();
      const target = event.target instanceof Element ? event.target.closest("img, [data-member-video]") : null;
      if (target) editor.commands.setNodeSelection(editor.view.posAtDOM(target, 0));
      else {
        const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        const selection = editor.state.selection;
        if (position !== undefined && (selection.empty || position < selection.from || position > selection.to))
          editor.commands.setTextSelection(position);
      }
      menu.current?.openAt({ x: event.clientX, y: event.clientY }, canvas);
    }
    function keyboard(event: KeyboardEvent) {
      if (disabled || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = editor.view.coordsAtPos(editor.state.selection.from);
      menu.current?.openAt({ x: bounds.left, y: bounds.bottom }, canvas);
    }
    canvas.addEventListener("pointerdown", recordPointer);
    canvas.addEventListener("contextmenu", context);
    canvas.addEventListener("keydown", keyboard);
    return () => {
      canvas.removeEventListener("pointerdown", recordPointer);
      canvas.removeEventListener("contextmenu", context);
      canvas.removeEventListener("keydown", keyboard);
    };
  }, [editor, disabled]);
  return (
    <span data-content-actions>
      <Menu
        label="Content actions"
        title="Content actions (Shift+F10)"
        disabled={disabled}
        menuRef={menu}
        variant="plain"
        triggerClass={buttonClasses({ variant: "ghost" }, undefined)}
        align="end"
        items={editorContextActions(editor, { formatting, editLayout, editMedia, allowMove })}
      >
        Actions
      </Menu>
    </span>
  );
}
