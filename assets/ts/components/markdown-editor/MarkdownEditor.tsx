import { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { resolveMarkdownShortcodes } from "../../../shared/markdown-shortcodes";
import { Button } from "../../ui/Button";
import { Textarea } from "../../ui/TextControl";
import type { FieldControlProps } from "../../ui/Field";
import { editorExtensions } from "./editor-extensions";
import {
  BLOCK_TRANSFER_TYPE,
  EDITOR_BLOCKS,
  insertEditorBlock,
  editorBlockPosition,
  moveEditorBlock,
  type EditorBlock,
} from "./editor-blocks";
import { EditorMediaFields } from "./EditorMediaFields";
import "./markdown-editor.scss";
import "./markdown-content.scss";

export interface MarkdownEditorProps extends FieldControlProps {
  name: string;
  label: string;
  initialValue: string;
  disabled?: boolean;
  onChange: (markdown: string) => void;
}

export function MarkdownEditor({
  initialValue,
  onChange,
  disabled = false,
  name,
  label,
  ...control
}: MarkdownEditorProps) {
  // One document owns an edit session. Parent renders must never reparse a
  // previous serialized draft while ProseMirror is applying the next input.
  const [value, setValue] = useState(initialValue);
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, refresh] = useState(0);
  const [source, setSource] = useState(false);
  const [media, setMedia] = useState<{ kind: "image" | "video" | "link"; position: number } | null>(null);
  const addBlock = useRef<(kind: EditorBlock, position: number) => void>(() => {});
  addBlock.current = (kind, position) => {
    if (!editor || disabled) return;
    if (kind === "image" || kind === "video") setMedia({ kind, position: editorBlockPosition(editor, position) });
    else insertEditorBlock(editor, kind, position);
  };

  useEffect(() => {
    if (!host.current) return;
    const instance = new Editor({
      element: host.current,
      injectCSS: false,
      extensions: editorExtensions(),
      content: resolveMarkdownShortcodes(current.current.value),
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "pk-markdown-editor__canvas",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": label,
        },
        handleDrop(view, event) {
          const kind = event.dataTransfer?.getData(BLOCK_TRANSFER_TYPE);
          if (!kind || !EDITOR_BLOCKS.some((block) => block === kind)) return false;
          event.preventDefault();
          const position =
            view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.doc.content.size;
          addBlock.current(kind as EditorBlock, position);
          return true;
        },
      },
      onUpdate({ editor: updated }) {
        const next = updated.getMarkdown();
        setValue(next);
        current.current.onChange(next);
        if (input.current) {
          input.current.value = next;
          input.current.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      onSelectionUpdate() {
        refresh((revision) => revision + 1);
      },
      onTransaction() {
        refresh((revision) => revision + 1);
      },
    });
    setEditor(instance);
    return () => {
      instance.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled, false);
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          class: "pk-markdown-editor__canvas",
          id: source ? `${control.id}-visual` : control.id,
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          "aria-disabled": String(disabled),
          "aria-invalid": source ? "false" : (control["aria-invalid"] ?? "false"),
          "aria-describedby": control["aria-describedby"] ?? "",
        },
      },
    });
  }, [editor, disabled, source, control.id, control["aria-invalid"], control["aria-describedby"], label]);

  const locked = disabled || !editor || source;
  const position = () => editor?.state.selection.from ?? 0;
  const formats = [
    { label: "Bold", active: "bold", run: () => editor?.chain().focus().toggleBold().run() },
    { label: "Italic", active: "italic", run: () => editor?.chain().focus().toggleItalic().run() },
    { label: "Heading", active: "heading", run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Bulleted list", active: "bulletList", run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", active: "orderedList", run: () => editor?.chain().focus().toggleOrderedList().run() },
  ];
  return (
    <div class="pk-markdown-editor">
      <div class="pk-markdown-editor__toolbar" role="group" aria-label="Text formatting">
        {formats.map((format) => (
          <Button
            key={format.label}
            size="sm"
            variant="ghost"
            disabled={locked}
            aria-pressed={Boolean(editor?.isActive(format.active))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={format.run}
          >
            {format.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={locked}
          onClick={() => setMedia({ kind: "link", position: position() })}
        >
          Link
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          Redo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-pressed={source}
          onClick={() => {
            if (source)
              editor?.commands.setContent(resolveMarkdownShortcodes(value), {
                contentType: "markdown",
                emitUpdate: false,
              });
            setSource(!source);
            setMedia(null);
          }}
        >
          {source ? "Visual editor" : "Markdown source"}
        </Button>
      </div>
      {!source && (
        <div class="pk-markdown-editor__blocks" role="group" aria-label="Content blocks">
          <span class="pk-small pk-muted">Insert or drag a block</span>
          {EDITOR_BLOCKS.map((kind) => (
            <Button
              key={kind}
              size="sm"
              disabled={locked}
              draggable={!locked}
              onDragStart={(event) => {
                event.dataTransfer?.setData(BLOCK_TRANSFER_TYPE, kind);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => addBlock.current(kind, position())}
            >
              {kind.charAt(0).toUpperCase() + kind.slice(1)}
            </Button>
          ))}
        </div>
      )}
      {!source && editor?.isActive("table") && (
        <div class="pk-markdown-editor__toolbar" role="group" aria-label="Table editing">
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            Add row
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            Add column
          </Button>
          <Button size="sm" variant="ghost" disabled={locked} onClick={() => editor.chain().focus().deleteRow().run()}>
            Delete row
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            Delete column
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            Remove table
          </Button>
        </div>
      )}
      {media && !source && (
        <EditorMediaFields
          key={`${media.kind}-${media.position}`}
          kind={media.kind}
          onCancel={() => setMedia(null)}
          onInsert={(insert) => {
            if (!editor) return;
            const node =
              insert.kind === "video"
                ? { type: "memberVideo", attrs: { url: insert.url } }
                : insert.kind === "image"
                  ? { type: "image", attrs: { src: insert.url, alt: insert.description } }
                  : {
                      type: "text",
                      text: insert.description || insert.url,
                      marks: [{ type: "link", attrs: { href: insert.url } }],
                    };
            editor
              .chain()
              .focus()
              .insertContentAt(media.position, insert.kind === "link" ? node : [node, { type: "paragraph" }])
              .run();
            setMedia(null);
          }}
        />
      )}
      <div ref={host} hidden={source} />
      {source && (
        <Textarea
          {...control}
          aria-label={`${label} Markdown source`}
          name={name}
          rows={12}
          value={value}
          disabled={disabled}
          onInput={(event) => {
            const next = event.currentTarget.value;
            setValue(next);
            onChange(next);
          }}
        />
      )}
      <input ref={input} type="hidden" name={source ? undefined : name} value={value} />
      <div class="pk-markdown-editor__footer">
        <span class="pk-small pk-muted">{value.length.toLocaleString()} characters · Saved as Markdown</span>
        {!source && (
          <div class="pk-cluster" role="group" aria-label="Move selected block">
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => editor && moveEditorBlock(editor, -1)}>
              Move up
            </Button>
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => editor && moveEditorBlock(editor, 1)}>
              Move down
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
