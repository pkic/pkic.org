import type { Editor, JSONContent } from "@tiptap/core";
import type { MarkdownMediaInsert } from "../../../shared/schemas/markdown-editor";
import { EditorMediaFields } from "./EditorMediaFields";

/** Transient insertion/replacement state; saved Markdown remains the authored source. */
export interface EditorMediaDraft {
  kind: MarkdownMediaInsert["kind"];
  position: number;
  replaceTo?: number;
  initialValue?: { url: string; description: string };
}

export function EditorMediaInsertion({
  editor,
  draft,
  onClose,
}: {
  editor: Editor;
  draft: EditorMediaDraft;
  onClose: () => void;
}) {
  function insert(media: MarkdownMediaInsert) {
    let node: JSONContent =
      media.kind === "video"
        ? { type: "memberVideo", attrs: { url: media.url } }
        : media.kind === "image"
          ? { type: "image", attrs: { src: media.url, alt: media.description } }
          : {
              type: "text",
              text: media.description || media.url,
              marks: [{ type: "link", attrs: { href: media.url } }],
            };
    if (media.kind === "button")
      node = {
        type: "button",
        attrs: { variant: draft.replaceTo ? editor.state.doc.nodeAt(draft.position)?.attrs.variant : "primary" },
        content: [{ type: "paragraph", content: [node] }],
      };
    editor
      .chain()
      .focus()
      .insertContentAt(
        draft.replaceTo ? { from: draft.position, to: draft.replaceTo } : draft.position,
        media.kind === "link" || media.kind === "button" ? node : [node, { type: "paragraph" }],
      )
      .run();
    onClose();
  }
  return <EditorMediaFields kind={draft.kind} initialValue={draft.initialValue} onInsert={insert} onCancel={onClose} />;
}
