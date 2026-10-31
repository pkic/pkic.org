import { lazy, Suspense } from "preact/compat";
import { CONTENT_PROSE_CLASS } from "../../site/ContentProse";
import type { JSX, RefObject } from "preact";
import { useStickyToolbar } from "../../ui/use-sticky-toolbar";
import { formatNumber } from "../../../shared/format-number";
import { codeLanguageItems } from "./code-language-menu";
import { TemplateHighlighting } from "./template-highlighting";
import { plainAmpersands, restoreTemplateMarkdown } from "./template-markdown";
import { Editor } from "@tiptap/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Menu, type MenuItem } from "../../ui/Menu";
import { resolveMarkdownShortcodes } from "../../../shared/markdown-shortcodes";
import { Button } from "../../ui/Button";
import { MarkdownSource } from "./MarkdownSource";
import {
  IconBold,
  IconBraces,
  IconLayers,
  IconContentGrid,
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
import type { MarkdownEditorProfile } from "./basic-editor-extensions";
import { useEditorExtensions } from "./use-editor-extensions";
import {
  BLOCK_TRANSFER_TYPE,
  EDITOR_BLOCKS,
  insertEditorBlock,
  editorBlockPosition,
  type EditorBlock,
} from "./editor-blocks";
import { useToolbarOverflow } from "./use-toolbar-overflow";
import type { EditorMediaDraft } from "./EditorMediaInsertion";
import "./markdown-editor.scss";
import "./markdown-content.scss";

const EditorMediaInsertion = lazy(() =>
  import("./EditorMediaInsertion").then((module) => ({ default: module.EditorMediaInsertion })),
);
const EditorContextMenu = lazy(() =>
  import("./EditorContextMenu").then((module) => ({ default: module.EditorContextMenu })),
);

const ContentLayoutPicker = lazy(() =>
  import("./ContentLayoutPicker").then((module) => ({ default: module.ContentLayoutPicker })),
);

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
   * `full` provides a tall canvas; `compact` keeps a field a few lines high.
   * The profile determines formatting capabilities independently of this size.
   */
  variant?: "full" | "compact";
  /** Authoring capabilities are independent of the canvas size. */
  profile?: MarkdownEditorProfile;
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
  profile = "basic",
  initialMode = "visual",
  templateInsertions,
  editorRef,
  onFocus,
  ...control
}: MarkdownEditorProps) {
  const compact = variant === "compact";
  const extensions = useEditorExtensions(profile);
  const activeExtensions = useRef(extensions);
  const canvasClass = compact ? "pk-markdown-editor__canvas" : `${CONTENT_PROSE_CLASS} pk-markdown-editor__canvas`;
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
  useStickyToolbar(root);
  // How many of the bar's commands fit beside the source button; the rest
  // fold into one `…` menu rather than wrapping onto a second line (#114).
  const toolbar = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<EditorMediaDraft | null>(null);
  const pickerAnchor = useRef<HTMLElement>(null);
  const [layoutPicker, setLayoutPicker] = useState<{ editing: boolean; table: boolean } | null>(null);
  const closeLayoutPicker = useCallback((returnFocus: boolean) => {
    setLayoutPicker(null);
    if (returnFocus) pickerAnchor.current?.focus({ preventScroll: true });
  }, []);
  const openLayoutPicker = (editing: boolean, table: boolean, anchor?: HTMLElement) => {
    pickerAnchor.current =
      anchor ??
      toolbar.current?.querySelector<HTMLElement>("[data-content-actions] button, [data-overflow] button") ??
      null;
    setLayoutPicker({ editing, table });
  };
  const addBlock = useRef<(kind: EditorBlock, position: number) => void>(() => {});
  addBlock.current = (kind, position) => {
    if (!editor || disabled || profile !== "content") return;
    if (kind === "image" || kind === "video") setMedia({ kind, position: editorBlockPosition(editor, position) });
    else insertEditorBlock(editor, kind, position);
  };

  useEffect(() => {
    if (!host.current?.isConnected || !extensions) return;
    const instance = new Editor({
      element: host.current,
      injectCSS: false,
      extensions: [...extensions, ...(templateInsertions ? [TemplateHighlighting] : [])],
      content: resolveMarkdownShortcodes(current.current.value),
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: canvasClass,
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
        const serialized = plainAmpersands(updated.getMarkdown());
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
    activeExtensions.current = extensions;
    setEditor(instance);
    return () => {
      instance.destroy();
    };
  }, [extensions]);

  useLayoutEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled, false);
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          class: canvasClass,
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
    canvasClass,
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

  const locked = disabled || !editor || source || activeExtensions.current !== extensions;
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
    contentOnly?: boolean;
    icon: JSX.Element;
    active?: string;
    disabled?: boolean;
    pressed?: boolean;
    run: () => void;
    choices?: MenuItem[];
    block?: EditorBlock;
    picker?: "layout" | "table";
  };
  const groups: ToolbarCommand[][] = [
    [
      {
        label: "Heading",
        contentOnly: true,
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
        contentOnly: true,
        icon: <IconQuote />,
        active: "blockquote",
        block: "callout",
        run: () => runFocused((focused) => focused.commands.toggleBlockquote()),
      },
      {
        label: "Supporting note",
        contentOnly: true,
        icon: <IconLayers />,
        active: "aside",
        block: "aside",
        run: () => runFocused((focused) => focused.commands.toggleWrap("aside")),
      },
      {
        label: "Insert layout",
        contentOnly: true,
        icon: <IconContentGrid />,
        picker: "layout",
        run: () => openLayoutPicker(false, false),
      },
      {
        label: "Code",
        contentOnly: true,
        icon: <IconCode />,
        run: () => {},
        choices: [
          {
            id: "inline-code",
            label: "Inline code",
            checked: Boolean(editor?.isActive("code")),
            disabled: locked,
            onSelect: () => runFocused((focused) => focused.commands.toggleCode()),
          },
          { id: "code-block", label: "Code block", disabled: locked, children: codeLanguageItems(editor, locked) },
        ],
      },
      {
        label: "Link",
        icon: <IconLink width="16" height="16" />,
        run: () => setMedia({ kind: "link", position: position() }),
        choices:
          profile === "content"
            ? [
                {
                  id: "text-link",
                  label: "Text link",
                  disabled: locked,
                  onSelect: () => setMedia({ kind: "link", position: position() }),
                },
                {
                  id: "button-link",
                  label: "Button",
                  disabled: locked,
                  onSelect: () => setMedia({ kind: "button", position: position() }),
                },
              ]
            : undefined,
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
      {
        label: "Table",
        contentOnly: true,
        icon: <IconTable />,
        block: "table",
        picker: "table",
        run: () => openLayoutPicker(false, true),
      },
      {
        label: "Image",
        contentOnly: true,
        icon: <IconImage />,
        block: "image",
        run: () => addBlock.current("image", position()),
      },
      {
        label: "Video",
        contentOnly: true,
        icon: <IconVideo />,
        block: "video",
        run: () => addBlock.current("video", position()),
      },
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
  const activeGroups = groups
    .map((group) => group.filter((command) => profile === "content" || !command.contentOnly))
    .filter((group) => group.length);
  const commands = activeGroups.flat();
  const visibleCommands = useToolbarOverflow(toolbar, commands.length);
  const menuCommands: MenuItem[] = commands.map((command) => ({
    id: command.label,
    label: command.label,
    icon: command.icon,
    disabled: locked || command.disabled,
    checked: command.active ? Boolean(editor?.isActive(command.active)) : undefined,
    onSelect: command.run,
    children: command.choices,
  }));
  const foldedCommands = menuCommands.slice(visibleCommands);
  return (
    <div ref={root} class="pk-markdown-editor" data-variant={variant} onFocusIn={onFocus}>
      <div
        ref={toolbar}
        class="pk-markdown-editor__toolbar"
        data-density="compact"
        role="group"
        aria-label="Text formatting"
      >
        {activeGroups.map((group, index) => (
          <div
            key={index}
            class="pk-markdown-editor__group"
            role="presentation"
            data-group={index}
            hidden={activeGroups.slice(0, index).flat().length >= visibleCommands}
          >
            {group.map((command, commandIndex) => (
              <span
                key={command.label}
                data-command={activeGroups.slice(0, index).flat().length + commandIndex}
                data-section-start={commandIndex === 0}
                hidden={activeGroups.slice(0, index).flat().length + commandIndex >= visibleCommands}
              >
                {command.choices ? (
                  <Menu label={command.label} items={command.choices}>
                    {command.icon}
                  </Menu>
                ) : (
                  <Button
                    variant="ghost"
                    icon
                    aria-label={command.label}
                    title={command.label}
                    aria-haspopup={command.picker ? "dialog" : undefined}
                    disabled={locked || command.disabled}
                    aria-pressed={command.active ? Boolean(editor?.isActive(command.active)) : undefined}
                    onMouseDown={(event) => {
                      if (!command.block && !command.picker) event.preventDefault();
                    }}
                    draggable={Boolean(command.block) && !locked}
                    onDragStart={(event) => {
                      if (!command.block || locked) return;
                      event.dataTransfer?.setData(BLOCK_TRANSFER_TYPE, command.block);
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={(event) => {
                      if (command.picker) openLayoutPicker(false, command.picker === "table", event.currentTarget);
                      else command.run();
                    }}
                  >
                    {command.icon}
                  </Button>
                )}
              </span>
            ))}
          </div>
        ))}
        <div class="pk-markdown-editor__group pk-markdown-editor__group--end" role="presentation" data-end>
          {editor && (
            <Suspense fallback={null}>
              <EditorContextMenu
                editor={editor}
                disabled={locked}
                formatting={menuCommands}
                editLayout={() => openLayoutPicker(true, false)}
                editMedia={setMedia}
                allowMove={profile === "content" && !compact}
              />
            </Suspense>
          )}
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
      {layoutPicker && editor && (
        <Suspense fallback={null}>
          <ContentLayoutPicker
            editor={editor}
            anchorRef={pickerAnchor}
            editing={layoutPicker.editing}
            table={layoutPicker.table}
            onClose={closeLayoutPicker}
          />
        </Suspense>
      )}
      {media && editor && !source && (
        <Suspense fallback={null}>
          <EditorMediaInsertion
            key={`${media.kind}-${media.position}`}
            editor={editor}
            draft={media}
            onClose={() => setMedia(null)}
          />
        </Suspense>
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
        <span class="pk-small pk-muted">{formatNumber(value.length)} characters · Saved as Markdown</span>
      </div>
    </div>
  );
}
