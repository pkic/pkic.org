import type { Editor } from "@tiptap/core";
import type { RefObject } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { contentLayoutSchema } from "../../../shared/schemas/content-layout";
import {
  markdownBentoPresets,
  markdownLayoutLimits,
  type MarkdownLayoutChoice,
  type MarkdownLayoutKind,
} from "../../../shared/schemas/markdown-layout";
import { formatNumber } from "../../../shared/format-number";
import { Button } from "../../ui/Button";
import { SectionHeading } from "../../ui/SectionHeading";
import { CloseButton } from "../../ui/CloseButton";
import { usePopupPlacement } from "../../ui/popup-placement";
import { applyEditorLayout, selectedEditorLayout } from "./editor-layout-editing";
import { LayoutPreview } from "./LayoutPreview";
import { LayoutSizeGrid } from "./LayoutSizeGrid";
import "./ContentLayoutPicker.css";

const labels = { columns: "Text columns", grid: "Grid", cards: "Cards", bento: "Bento", table: "Table" } as const;

/** A single anchored layout palette; insertion chooses a size immediately, editing preserves existing child contents. */
export function ContentLayoutPicker({
  editor,
  anchorRef,
  editing = false,
  table = false,
  onClose,
}: {
  editor: Editor;
  anchorRef: RefObject<HTMLElement>;
  editing?: boolean;
  table?: boolean;
  onClose: (returnFocus: boolean) => void;
}) {
  const target = editing ? selectedEditorLayout(editor) : null;
  const initial: MarkdownLayoutKind = table
    ? "table"
    : target?.node.type.name === "cards"
      ? target.node.attrs.layout === "bento"
        ? "bento"
        : "cards"
      : target?.node.type.name === "grid"
        ? "grid"
        : "columns";
  const [kind, setKind] = useState<MarkdownLayoutKind>(initial);
  const popup = useRef<HTMLDivElement>(null);
  const heading = useId();
  const title = table ? "Insert table" : editing ? "Edit layout" : "Insert layout";
  const available: MarkdownLayoutKind[] = table
    ? []
    : target
      ? target.node.type.name === "cards"
        ? ["cards", "bento"]
        : [initial]
      : ["columns", "grid", "cards", "bento"];
  usePopupPlacement({
    open: true,
    anchorRef,
    popupRef: popup,
    topLayer: true,
    align: "start",
    revision: kind,
  });
  useLayoutEffect(() => {
    popup.current?.querySelector<HTMLButtonElement>('[data-initial-focus="true"]')?.focus({ preventScroll: true });
  }, [kind]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node))
        onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [anchorRef, onClose]);
  function apply(choice: MarkdownLayoutChoice) {
    onClose(false);
    applyEditorLayout(editor, choice, editing);
  }
  const countChoices = kind === "columns" || (editing && kind !== "bento" && kind !== "table");
  return (
    <div
      ref={popup}
      role="dialog"
      aria-modal="false"
      aria-labelledby={heading}
      class="pk pk-layout-picker"
      data-density="compact"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next) && !anchorRef.current?.contains(next))
          onClose(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        }
      }}
    >
      <div class="pk-layout-picker__heading">
        <SectionHeading level={3} id={heading}>
          {title}
        </SectionHeading>
        <CloseButton label="Close layout picker" onClick={() => onClose(true)} />
      </div>
      {available.length > 1 && (
        <div class="pk-layout-picker__types" role="group" aria-label="Layout type">
          {available.map((value) => (
            <Button key={value} variant="ghost" aria-pressed={value === kind} onClick={() => setKind(value)}>
              {labels[value]}
            </Button>
          ))}
        </div>
      )}
      {kind !== "table" && <p class="pk-layout-picker__label">{labels[kind]}</p>}
      {countChoices ? (
        <>
          <div class="pk-layout-picker__counts" role="group" aria-label="Column count">
            {contentLayoutSchema.options
              .filter((value) => value !== "auto")
              .map((value) => (
                <Button
                  key={value}
                  variant="ghost"
                  class="pk-layout-picker__choice"
                  data-initial-focus={value === "1" ? "true" : undefined}
                  aria-pressed={target ? target.node.attrs.count === value : undefined}
                  onClick={() =>
                    apply(
                      kind === "columns"
                        ? { kind: "columns", count: value }
                        : { kind: kind === "grid" ? "grid" : "cards", count: value },
                    )
                  }
                >
                  <LayoutPreview
                    kind={kind === "columns" ? "columns" : kind === "grid" ? "grid" : "cards"}
                    count={Number(value)}
                  />
                  <span>
                    {formatNumber(Number(value))} {value === "1" ? "column" : "columns"}
                  </span>
                </Button>
              ))}
          </div>
          <Button
            variant="ghost"
            aria-pressed={target ? !target.node.attrs.count || target.node.attrs.count === "auto" : undefined}
            onClick={() =>
              apply(
                kind === "columns"
                  ? { kind: "columns", count: "auto" }
                  : { kind: kind === "grid" ? "grid" : "cards", count: "auto" },
              )
            }
          >
            Automatic columns
          </Button>
        </>
      ) : kind === "bento" ? (
        <div class="pk-layout-picker__presets">
          {Object.entries(markdownBentoPresets).map(([key, preset]) => (
            <Button
              key={key}
              variant="ghost"
              class="pk-layout-picker__choice"
              data-initial-focus={key === "feature-left" ? "true" : undefined}
              aria-pressed={
                target
                  ? target.node.attrs.count === preset.count && target.node.firstChild?.attrs.rows === preset.rows
                  : undefined
              }
              onClick={() => apply({ kind: "bento", preset: key === "feature-top" ? "feature-top" : "feature-left" })}
            >
              <LayoutPreview kind="bento" top={key === "feature-top"} />
              <span>{preset.label}</span>
            </Button>
          ))}
        </div>
      ) : (
        <LayoutSizeGrid
          key={kind}
          columns={kind === "table" ? markdownLayoutLimits.table.columns : markdownLayoutLimits.grid.columns}
          rows={kind === "table" ? markdownLayoutLimits.table.rows : markdownLayoutLimits.grid.rows}
          label={`${labels[kind]} size`}
          onSelect={(columns, rows) =>
            apply(
              kind === "table"
                ? { kind: "table", columns, rows }
                : { kind: kind === "grid" ? "grid" : "cards", count: contentLayoutSchema.parse(String(columns)), rows },
            )
          }
        />
      )}
      <p class="pk-layout-picker__hint">
        {editing
          ? "Changing layout keeps every item and its contents."
          : kind === "columns"
            ? "Selected text flows down each column. On phones it reads in one column."
            : kind === "bento"
              ? "Choose a starting arrangement. Each card stays editable."
              : "Point to preview a size. Click or press Enter to insert."}
      </p>
    </div>
  );
}
