/**
 * FileInput — a file field that looks like the system's other controls.
 *
 * The browser's own file control is the one input a stylesheet cannot reach:
 * it draws a platform button, writes "No file chosen" beside it in a platform
 * font, and ignores every token we own. Left raw it is the loudest piece of
 * un-designed chrome on an otherwise migrated page.
 *
 * So the native `<input type="file">` is kept and made transparent, laid over
 * a row we draw. That is deliberate rather than clever: the element stays in
 * the tab order, keeps its `accept` filtering, keeps its role and its value,
 * and still opens the picker on Space or Enter. Nothing here re-implements a
 * behaviour the platform already has — the picture is ours, the control is
 * still the browser's. A `hidden` input driven by a separate button, which two
 * portal surfaces do today, gives up all of that.
 *
 * Like the controls in `TextControl`, it owns no label and no message. It
 * spreads whatever `Field` hands down — the id the label points at, the
 * describedby that carries the help text, the invalid flag — onto the real
 * input, so the accessible name and the guidance come from the one place that
 * should own them. A control that renders its own help text is a second
 * labelling path, and two labelling paths is how forms end up with orphaned
 * `for` attributes.
 */

import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";

import { Button } from "./Button";
import "./FileInput.css";

export interface FileInputProps extends Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "children"
> {
  /** The word on the control's own button. */
  buttonLabel?: string;
  /** Stands in for the file name until something is chosen. */
  placeholder?: string;
  /** The word on the control that empties the selection. */
  clearLabel?: string;
  /**
   * The value the field already has — an existing logo, a stored document.
   * Every page that shows one was inventing its own frame for it; this is the
   * slot, so the picture and the control that replaces it stay one component.
   */
  preview?: ComponentChildren;
  /** Called with the chosen file, and with null when the selection is emptied. */
  onFileChange?: (file: File | null) => void;
}

export function FileInput({
  buttonLabel = "Choose file",
  placeholder = "No file selected",
  clearLabel = "Clear",
  preview,
  onFileChange,
  disabled = false,
  class: className,
  ...rest
}: FileInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function select(file: File | null): void {
    setFileName(file?.name ?? null);
    onFileChange?.(file);
  }

  function clear(): void {
    const input = inputRef.current;
    if (input) {
      // The element holds the selection; emptying the label without emptying
      // the input leaves a form that submits a file nobody can see.
      input.value = "";
      // The button the user just pressed is about to be removed. Without this
      // the focus falls to the body and a keyboard user is thrown back to the
      // top of the page.
      input.focus();
    }
    select(null);
  }

  const classes = ["pk-file", disabled ? "pk-file--disabled" : null, className].filter(Boolean).join(" ");

  return (
    <div class={classes}>
      {preview !== undefined && preview !== null && <div class="pk-file__preview">{preview}</div>}

      <div class="pk-file__control">
        <div class="pk-file__field">
          <input
            {...rest}
            ref={inputRef}
            type="file"
            disabled={disabled}
            class="pk-file__input"
            onChange={(event) => select(event.currentTarget.files?.[0] ?? null)}
          />
          {/*
            Both of these are pictures of the input behind them. The input
            announces its own role and its own value, so repeating either here
            would have a screen reader read the control twice.
          */}
          <span class="pk-file__button" aria-hidden="true">
            {buttonLabel}
          </span>
          <span
            class={fileName === null ? "pk-file__name pk-file__name--empty" : "pk-file__name"}
            aria-hidden="true"
            title={fileName ?? undefined}
          >
            {fileName ?? placeholder}
          </span>
        </div>

        {fileName !== null && !disabled && (
          // The name is in the accessible label rather than only in the muted
          // text above, which is hidden: this is where a screen reader user
          // finds out which file they are about to drop.
          <Button
            variant="ghost"
            size="sm"
            class="pk-file__clear"
            aria-label={`${clearLabel} ${fileName}`}
            onClick={clear}
          >
            {clearLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
