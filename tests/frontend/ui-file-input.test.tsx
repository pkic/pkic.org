// @vitest-environment jsdom
/**
 * The FileInput's contract.
 *
 * Two things are load-bearing and neither is visible in the markup at a
 * glance. The native input is transparent rather than hidden, so it must still
 * be the element the field's label points at — a picture of a control with the
 * real one removed from the tab order is the failure this component exists to
 * avoid. And the control that empties the selection must be a real button a
 * keyboard can reach, with somewhere for focus to go once it disappears.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Field } from "../../assets/ts/ui/Field";
import { FileInput } from "../../assets/ts/ui/FileInput";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

function fileInput(container: HTMLElement): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!found) throw new Error("no file input rendered");
  return found;
}

/**
 * jsdom has no file picker, so the selection is written onto the element the
 * way the user agent would and the change is dispatched. `files` is read-only,
 * hence the defineProperty rather than an assignment.
 */
function choose(input: HTMLInputElement, name: string): File {
  const file = new File(["contents"], name, { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  void act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return file;
}

function clearButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(".pk-file__clear");
}

describe("FileInput", () => {
  it("is the element the field's label names, and is still a file input", () => {
    const container = mount(<Field label="Supporting document">{(control) => <FileInput {...control} />}</Field>);
    const label = container.querySelector("label");
    expect(label?.getAttribute("for")).toBe(fileInput(container).id);
    expect(fileInput(container).id).not.toBe("");
    expect(fileInput(container).type).toBe("file");
  });

  it("carries the field's help text and its required flag onto the real input", () => {
    const container = mount(
      <Field label="Supporting document" required help="PDF, up to 5 MB.">
        {(control) => <FileInput {...control} accept="application/pdf" />}
      </Field>,
    );
    const input = fileInput(container);
    expect(input.required).toBe(true);
    expect(input.getAttribute("accept")).toBe("application/pdf");
    const describedBy = input.getAttribute("aria-describedby");
    expect(container.querySelector(`#${describedBy}`)?.textContent).toBe("PDF, up to 5 MB.");
  });

  it("marks the input invalid when the field blocks submission", () => {
    const container = mount(
      <Field label="Charter" state="invalid" message="Choose a file to upload.">
        {(control) => <FileInput {...control} />}
      </Field>,
    );
    expect(fileInput(container).getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a placeholder until a file is chosen, then the file's name", () => {
    const container = mount(<Field label="Charter">{(control) => <FileInput {...control} />}</Field>);
    expect(container.querySelector(".pk-file__name")?.textContent).toBe("No file selected");

    choose(fileInput(container), "charter-2026.pdf");
    expect(container.querySelector(".pk-file__name")?.textContent).toBe("charter-2026.pdf");
  });

  it("reports the chosen file to the caller", () => {
    const onFileChange = vi.fn();
    const container = mount(
      <Field label="Charter">{(control) => <FileInput {...control} onFileChange={onFileChange} />}</Field>,
    );
    const file = choose(fileInput(container), "charter-2026.pdf");
    expect(onFileChange).toHaveBeenCalledWith(file);
  });

  it("offers nothing to clear until there is a selection", () => {
    const container = mount(<Field label="Charter">{(control) => <FileInput {...control} />}</Field>);
    expect(clearButton(container)).toBeNull();
  });

  it("clears the selection from the keyboard and leaves focus somewhere useful", () => {
    const onFileChange = vi.fn();
    const container = mount(
      <Field label="Charter">{(control) => <FileInput {...control} onFileChange={onFileChange} />}</Field>,
    );
    const input = fileInput(container);
    choose(input, "charter-2026.pdf");

    const clear = clearButton(container);
    // A real, enabled button: the keyboard reaches it by Tab and activates it
    // with Enter or Space, which is what produces the click below.
    expect(clear).toBeInstanceOf(HTMLButtonElement);
    expect(clear?.disabled).toBe(false);
    expect(clear?.getAttribute("aria-hidden")).toBeNull();
    // The name is only in the accessible label — the visible one is hidden —
    // so this is where a screen reader user learns which file is going.
    expect(clear?.getAttribute("aria-label")).toBe("Clear charter-2026.pdf");

    clear?.focus();
    expect(document.activeElement).toBe(clear);

    void act(() => clear?.click());

    expect(onFileChange).toHaveBeenLastCalledWith(null);
    expect(container.querySelector(".pk-file__name")?.textContent).toBe("No file selected");
    expect(clearButton(container)).toBeNull();
    expect(input.value).toBe("");
    // The button it was on has gone; focus must not fall back to the body.
    expect(document.activeElement).toBe(input);
  });

  it("disables the input and withholds the clear control when disabled", () => {
    const container = mount(<Field label="Charter">{(control) => <FileInput {...control} disabled />}</Field>);
    const input = fileInput(container);
    expect(input.disabled).toBe(true);
    choose(input, "charter-2026.pdf");
    expect(clearButton(container)).toBeNull();
  });

  it("renders the caller's preview of the value the field already holds", () => {
    const container = mount(
      <Field label="Organization logo">
        {(control) => <FileInput {...control} preview={<img src="logo.svg" alt="Current logo" />} />}
      </Field>,
    );
    const preview = container.querySelector(".pk-file__preview img");
    expect(preview?.getAttribute("alt")).toBe("Current logo");
  });

  it("hides its own drawing of the control from assistive technology", () => {
    // The input announces its own role and its own value. A second copy of
    // both, read out of the decoration around it, is noise.
    const container = mount(<Field label="Charter">{(control) => <FileInput {...control} />}</Field>);
    expect(container.querySelector(".pk-file__button")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".pk-file__name")?.getAttribute("aria-hidden")).toBe("true");
  });
});
