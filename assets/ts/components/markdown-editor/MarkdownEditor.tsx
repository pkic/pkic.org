import type { JSX, RefObject } from "preact";
import { TemplateHighlighting } from "./template-highlighting";
import { restoreTemplateMarkdown } from "./template-markdown";
import { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Menu, type MenuItem } from "../../ui/Menu";
import { resolveMarkdownShortcodes } from "../../../shared/markdown-shortcodes";
import { Button } from "../../ui/Button";
import { MarkdownSource } from "./MarkdownSource";
import {
  IconBold,
  IconBraces,
  IconLayers,
  IconBulletList,
  IconCode,
  IconHeading,
  IconItalic,
  IconImage,
  IconVideo,
  IconTable,
  IconLink,
  IconNumberedList,
  IconQuote,
  IconRedo,
  IconSource,
  IconUndo,
} from "../icons";
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
import { useToolbarOverflow } from "./use-toolbar-overflow";
import { EditorMediaFields } from "./EditorMediaFields";
import "./markdown-editor.scss";
import "./markdown-content.scss";

export interface MarkdownEditorHandle {
  insertText: (text: string) => void;
}

export interface MarkdownEditorProps extends FieldControlProps {
  name: string;
  label: string;
  initialValue: string;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  /**
   * `full` is the page-content editor with a tall canvas and block movement.
   * `compact` uses the same formatting and insertion controls with a canvas
   * a few lines tall for a biography, a note or a message.
   */
  variant?: "full" | "compact";
  /** Choose the initial editing view; template tokens are preserved in either view. */
  initialMode?: "visual" | "source";
  /** Template source highlights variables and blocks and exposes insertion commands. */
  templateInsertions?: readonly MenuItem[];
  editorRef?: RefObject<MarkdownEditorHandle>;
  onFocus?: () => void;
}

export function MarkdownEditor({
  initialValue,
  onChange,
  disabled = false,
  name,
  label,
  variant = "full",
  initialMode = "visual",
  templateInsertions,
  editorRef,
  onFocus,
  ...control
}: MarkdownEditorProps) {
  const compact = variant === "compact";
  // One document owns an edit session. Parent renders must never reparse a
  // previous serialized draft while ProseMirror is applying the next input.
  const [value, setValue] = useState(initialValue);
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, refresh] = useState(0);
  const [source, setSource] = useState(initialMode === "source");
  const root = useRef<HTMLDivElement>(null);
  // How many of the bar's commands fit beside the source button; the rest
  // fold into one `…` menu rather than wrapping onto a second line (#114).
  const toolbar = useRef<HTMLDivElement>(null);
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
      extensions: [...editorExtensions(), ...(templateInsertions ? [TemplateHighlighting] : [])],
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
        const serialized = updated.getMarkdown();
        const next = templateInsertions ? restoreTemplateMarkdown(serialized) : serialized;
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
          "aria-required": control.required ? "true" : "false",
          "aria-disabled": String(disabled),
          "aria-invalid": source ? "false" : (control["aria-invalid"] ?? "false"),
          "aria-describedby": control["aria-describedby"] ?? "",
        },
      },
    });
  }, [
    editor,
    disabled,
    source,
    control.id,
    control.required,
    control["aria-invalid"],
    control["aria-describedby"],
    label,
  ]);

  useLayoutEffect(() => {
    if (!editorRef) return;
    editorRef.current = {
      insertText(text) {
        if (disabled) return;
        const textarea = root.current?.querySelector("textarea");
        if (source && textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const next = `${current.current.value.slice(0, start)}${text}${current.current.value.slice(end)}`;
          setValue(next);
          current.current.onChange(next);
          requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(start + text.length, start + text.length);
          });
        } else {
          editor?.chain().focus().insertContent({ type: "text", text }).run();
        }
      },
    };
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef, source, disabled]);

  const locked = disabled || !editor || source;
  const runFocused = (run: (focused: Editor) => void) => {
    if (!editor) return;
    editor.view.focus();
    run(editor);
  };
  const position = () => editor?.state.selection.from ?? 0;
  const toggleSource = () => {
    if (source)
      editor?.commands.setContent(resolveMarkdownShortcodes(value), {
        contentType: "markdown",
        emitUpdate: false,
      });
    setSource(!source);
    setMedia(null);
  };
  /**
   * The bar: one glyph per command, grouped the way a writer thinks of them
   * — the text's shape, then its structure, then the session — and the same
   * at both densities, since a row of glyphs is already as short as the
   * compact bar needs to be (issue 114). Every button carries its name for
   * assistive technology and as a tooltip; the glyph inside is decorative.
   */
  type ToolbarCommand = {
    label: string;
    icon: JSX.Element;
    active?: string;
    disabled?: boolean;
    pressed?: boolean;
    run: () => void;
    choices?: MenuItem[];
    block?: EditorBlock;
  };
  const groups: ToolbarCommand[][] = [
    [
      {
        label: "Heading",
        icon: <IconHeading />,
        active: "heading",
        run: () => {},
        choices: [
          {
            id: "paragraph",
            label: "Paragraph",
            checked: Boolean(editor?.isActive("paragraph")),
            disabled: locked,
            onSelect: () => {
              runFocused((focused) => focused.commands.setParagraph());
            },
          },
          ...([2, 3, 4] as const).map((level) => ({
            id: `heading-${level}`,
            label: `Heading ${level}`,
            disabled: locked,
            checked: Boolean(editor?.isActive("heading", { level })),
            onSelect: () => {
              runFocused((focused) => focused.commands.setHeading({ level }));
            },
          })),
        ],
      },
      { label: "Bold", icon: <IconBold />, active: "bold", run: () => editor?.chain().focus().toggleBold().run() },
      {
        label: "Italic",
        icon: <IconItalic />,
        active: "italic",
        run: () => editor?.chain().focus().toggleItalic().run(),
      },
      {
        label: "Callout",
        icon: <IconQuote />,
        active: "blockquote",
        block: "callout",
        run: () => runFocused((focused) => focused.commands.toggleBlockquote()),
      },
      { label: "Code", icon: <IconCode />, active: "code", run: () => editor?.chain().focus().toggleCode().run() },
      {
        label: "Link",
        icon: <IconLink width="16" height="16" />,
        run: () => setMedia({ kind: "link", position: position() }),
      },
    ],
    [
      {
        label: "Bulleted list",
        icon: <IconBulletList />,
        active: "bulletList",
        run: () => editor?.chain().focus().toggleBulletList().run(),
      },
      {
        label: "Numbered list",
        icon: <IconNumberedList />,
        active: "orderedList",
        run: () => editor?.chain().focus().toggleOrderedList().run(),
      },
    ],
    [
      { label: "Table", icon: <IconTable />, block: "table", run: () => addBlock.current("table", position()) },
      { label: "Image", icon: <IconImage />, block: "image", run: () => addBlock.current("image", position()) },
      { label: "Video", icon: <IconVideo />, block: "video", run: () => addBlock.current("video", position()) },
    ],
    [
      {
        label: "Undo",
        icon: <IconUndo />,
        disabled: !editor?.can().undo(),
        run: () => editor?.chain().focus().undo().run(),
      },
      {
        label: "Redo",
        icon: <IconRedo />,
        disabled: !editor?.can().redo(),
        run: () => editor?.chain().focus().redo().run(),
      },
    ],
  ];
  const commands = groups.flat();
  const visibleCommands = useToolbarOverflow(toolbar, commands.length);
  const foldedCommands: MenuItem[] = commands.slice(visibleCommands).map((command) => ({
    id: command.label,
    label: command.label,
    icon: command.icon,
    disabled: locked || command.disabled,
    checked: command.active ? Boolean(editor?.isActive(command.active)) : undefined,
    onSelect: command.run,
    children: command.choices,
  }));
  return (
    <div ref={root} class="pk-markdown-editor" data-variant={variant} onFocusIn={onFocus}>
      <div ref={toolbar} class="pk-markdown-editor__toolbar" role="group" aria-label="Text formatting">
        {groups.map((group, index) => (
          <div
            key={index}
            class="pk-markdown-editor__group"
            role="presentation"
            data-group={index}
            hidden={groups.slice(0, index).flat().length >= visibleCommands}
          >
            {group.map((command, commandIndex) => (
              <span
                key={command.label}
                data-command={groups.slice(0, index).flat().length + commandIndex}
                data-section-start={commandIndex === 0}
                hidden={groups.slice(0, index).flat().length + commandIndex >= visibleCommands}
              >
                {command.choices ? (
                  <Menu label={command.label} items={command.choices}>
                    {command.icon}
                  </Menu>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon
                    aria-label={command.label}
                    title={command.label}
                    disabled={locked || command.disabled}
                    aria-pressed={command.active ? Boolean(editor?.isActive(command.active)) : undefined}
                    onMouseDown={(event) => {
                      if (!command.block) event.preventDefault();
                    }}
                    draggable={Boolean(command.block) && !locked}
                    onDragStart={(event) => {
                      if (!command.block || locked) return;
                      event.dataTransfer?.setData(BLOCK_TRANSFER_TYPE, command.block);
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={command.run}
                  >
                    {command.icon}
                  </Button>
                )}
              </span>
            ))}
          </div>
        ))}
        <div class="pk-markdown-editor__group pk-markdown-editor__group--end" role="presentation" data-end>
          {templateInsertions && (
            <>
              <Menu
                label="Insert variables and conditions"
                items={templateInsertions.filter((item) => !item.id.startsWith("partial-"))}
                align="end"
              >
                <IconBraces />
              </Menu>
              <Menu
                label="Insert reusable templates"
                items={templateInsertions.filter((item) => item.id.startsWith("partial-"))}
                align="end"
              >
                <IconLayers />
              </Menu>
            </>
          )}
          {foldedCommands.length > 0 && (
            <span data-overflow>
              <Menu label="More formatting" items={foldedCommands} align="end" />
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon
            data-source
            aria-label={source ? "Visual editor" : "Markdown source"}
            title={source ? "Visual editor" : "Markdown source"}
            disabled={disabled}
            aria-pressed={source}
            onClick={toggleSource}
          >
            <IconSource />
          </Button>
        </div>
      </div>
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
        <MarkdownSource
          {...control}
          templateSyntax={Boolean(templateInsertions)}
          aria-label={`${label} Markdown source`}
          name={name}
          rows={compact ? 4 : 12}
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
        {!source && !compact && (
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
