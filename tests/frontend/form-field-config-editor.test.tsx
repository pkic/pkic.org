// @vitest-environment jsdom
/**
 * The per-field configuration editor inside the form definition editor.
 *
 * The assertions locate controls through their label/`for` relationship rather
 * than by class name, because that relationship is what the surface promises to
 * a screen reader and to a keyboard user — the class names are only how it is
 * built. The two exceptions are deliberate and marked: the checkbox and the
 * mode switch are the two places where a wrong class or a missing attribute
 * renders something that looks plausible and behaves wrongly, and no other gate
 * in the repository can see either.
 */
import { render, type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { formFieldRulesSchema } from "../../assets/shared/schemas/form-field-rules";
import {
  buildFieldValidation,
  FieldConfigEditor,
  type FieldDraft,
  type FieldType,
} from "../../assets/ts/components/forms/FormFieldConfigEditor";

const mounted: HTMLElement[] = [];

function draft(overrides: Partial<FieldDraft> = {}): FieldDraft {
  return {
    key: "favourite_colour",
    label: "Favourite colour",
    fieldType: "text",
    required: false,
    sortOrder: 0,
    optionsText: "",
    adminVisualization: "auto",
    placeholder: "",
    helpText: "",
    uiWidget: "",
    format: "",
    pattern: "",
    patternMessage: "",
    minLength: "",
    maxLength: "",
    min: "",
    max: "",
    step: "",
    minItems: "",
    maxItems: "",
    allowCustom: false,
    allowedDomainsText: "",
    advancedValidationText: "{}",
    rawMode: false,
    rawValidationText: "{}",
    ...overrides,
  };
}

/**
 * The editor is controlled by its parent, so the parent is what the test
 * renders: patches land in real state and the surface re-renders the way it
 * does in the application.
 */
function Harness({ initial, patches }: { initial: FieldDraft; patches: Array<Partial<FieldDraft>> }) {
  const [field, setField] = useState(initial);
  return (
    <FieldConfigEditor
      field={field}
      index={0}
      updateField={(_index, patch) => {
        patches.push(patch);
        setField((current) => ({ ...current, ...patch }));
      }}
    />
  );
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function mountEditor(initial: FieldDraft): { root: HTMLElement; patches: Array<Partial<FieldDraft>> } {
  const patches: Array<Partial<FieldDraft>> = [];
  return { root: mount(<Harness initial={initial} patches={patches} />), patches };
}

function labelled(root: HTMLElement, text: string): HTMLLabelElement | null {
  return [...root.querySelectorAll("label")].find((label) => (label.textContent ?? "").trim() === text) ?? null;
}

/** The control a visible label names, resolved through `for` → `id`. */
function controlFor(root: HTMLElement, text: string): HTMLElement {
  const label = labelled(root, text);
  if (!label) throw new Error(`no label reads "${text}"`);
  // getElementById rather than a `#id` selector: the id comes from useId and
  // jsdom here has no CSS.escape to make it selector-safe.
  const control = label.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!control) throw new Error(`label "${text}" names no control`);
  return control;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);
  if (!found) throw new Error(`no button reads "${text}"`);
  return found;
}

/** What `aria-describedby` actually points at, joined in order. */
function describedBy(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ");
}

/**
 * Typing, flushed. The edit has to be rendered before the next interaction:
 * the mode switch reads the draft from its own render, so an unflushed change
 * would be parsed from the value the operator has already replaced.
 */
function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  void act(() => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: HTMLElement): void {
  void act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("form field config editor", () => {
  it("names every control it shows, through a label/control pair", () => {
    const { root } = mountEditor(draft({ fieldType: "text" }));

    for (const name of ["Placeholder", "Help text", "Stats view", "Min length", "Max length", "Widget", "Format"]) {
      const control = controlFor(root, name);
      expect(control.id, `${name} control id`).not.toBe("");
      expect(labelled(root, name)?.htmlFor).toBe(control.id);
    }

    // Every control the surface renders is reachable by name. A control that
    // lost its label would leave a stray input behind this count.
    const named = [...root.querySelectorAll("label[for]")].length;
    expect(root.querySelectorAll("input[id], select[id], textarea[id]")).toHaveLength(named);
  });

  it("attaches guidance to the control it describes rather than to loose text", () => {
    const { root } = mountEditor(draft({ fieldType: "multi_select" }));

    expect(describedBy(controlFor(root, "Options"))).toBe("One per line.");
    expect(controlFor(root, "Options").getAttribute("aria-invalid")).toBeNull();
  });

  it("shows only the settings the field type supports", () => {
    const { root: text } = mountEditor(draft({ fieldType: "text" }));
    expect(labelled(text, "Pattern")).not.toBeNull();
    expect(labelled(text, "Options")).toBeNull();
    expect(labelled(text, "Allowed domains")).toBeNull();

    const { root: email } = mountEditor(draft({ fieldType: "email" }));
    expect(labelled(email, "Allowed domains")).not.toBeNull();
    expect(labelled(email, "Pattern")).toBeNull();

    const { root: choice } = mountEditor(draft({ fieldType: "multi_select" }));
    expect(labelled(choice, "Options")).not.toBeNull();
    expect(labelled(choice, "Min selections")).not.toBeNull();
    expect(labelled(choice, "Placeholder")).toBeNull();
  });

  it("reports edits as patches on the field it was given", () => {
    const { root, patches } = mountEditor(draft({ fieldType: "text" }));

    setValue(controlFor(root, "Help text") as HTMLInputElement, "Pick one");
    setValue(controlFor(root, "Max length") as HTMLInputElement, "40");

    expect(patches).toEqual([{ helpText: "Pick one" }, { maxLength: "40" }]);
  });

  it("draws the choice control with the design system's checkbox, not the operating system's", () => {
    const { root, patches } = mountEditor(draft({ fieldType: "select" }));

    // Deliberately a class assertion. `pk-check` alone on the label renders an
    // unstyled native control that passes every other gate in the repository,
    // which is exactly the regression this guards.
    const wrapper = [...root.querySelectorAll("label.pk-check")].at(0);
    expect(wrapper?.textContent).toContain("Allow custom answers");
    const input = wrapper?.querySelector("input");
    expect(input?.className).toContain("pk-check__input");
    expect(wrapper?.querySelector(".pk-check__label")?.textContent).toBe("Allow custom answers");

    void act(() => {
      input!.checked = true;
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(patches).toEqual([{ allowCustom: true }]);
  });

  it("says which editor is showing, and switches between them", () => {
    const { root, patches } = mountEditor(draft({ fieldType: "text", helpText: "Pick one" }));

    expect(button(root, "Visual").getAttribute("aria-pressed")).toBe("true");
    expect(button(root, "JSON").getAttribute("aria-pressed")).toBe("false");

    click(button(root, "JSON"));

    expect(button(root, "JSON").getAttribute("aria-pressed")).toBe("true");
    expect(button(root, "Visual").getAttribute("aria-pressed")).toBe("false");
    expect(patches.at(0)).toMatchObject({ rawMode: true });
    expect(controlFor(root, "Validation JSON")).toBeInstanceOf(HTMLTextAreaElement);
    expect((controlFor(root, "Validation JSON") as HTMLTextAreaElement).value).toContain('"helpText": "Pick one"');
  });

  it("parses the JSON back into structured settings, keeping what the controls cannot show", () => {
    const { root, patches } = mountEditor(draft({ fieldType: "text", rawMode: true, rawValidationText: "{}" }));

    // `requireTrue` is a rule the contract knows and the visual editor has no
    // control for, so it survives in the overflow rather than being dropped.
    setValue(
      controlFor(root, "Validation JSON") as HTMLTextAreaElement,
      '{"placeholder":"e.g. blue","maxLength":40,"requireTrue":true}',
    );
    click(button(root, "Visual"));

    expect((controlFor(root, "Placeholder") as HTMLInputElement).value).toBe("e.g. blue");
    expect((controlFor(root, "Max length") as HTMLInputElement).value).toBe("40");
    expect(patches.at(-1)).toMatchObject({ rawMode: false, advancedValidationText: '{\n  "requireTrue": true\n}' });
  });

  it("refuses JSON the rules contract rejects on the text control, and stays in JSON mode", () => {
    const { root } = mountEditor(draft({ fieldType: "text", rawMode: true, rawValidationText: "{}" }));

    // Valid JSON, invalid rules: the contract is what says so, in place.
    setValue(controlFor(root, "Validation JSON") as HTMLTextAreaElement, '{"minLength":50,"maxLength":40}');
    click(button(root, "Visual"));

    expect(button(root, "JSON").getAttribute("aria-pressed")).toBe("true");
    const control = controlFor(root, "Validation JSON");
    expect(control.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(control.getAttribute("aria-describedby") ?? "");
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("maxLength must not be below minLength");
  });

  it("checks the visual controls through the rules contract as they are typed", () => {
    const { root } = mountEditor(draft({ fieldType: "text" }));

    // A pattern outside the safe subset is refused on the pattern control.
    const pattern = controlFor(root, "Pattern") as HTMLInputElement;
    setValue(pattern, "(a|b)+");
    expect(pattern.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
    expect(pattern.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(pattern)).toContain("safe, bounded regular-expression subset");
    // The neighbouring control is untouched and says nothing.
    expect(controlFor(root, "Pattern error message").getAttribute("aria-invalid")).toBeNull();

    setValue(pattern, "^[a-z]{2,4}$");
    expect(pattern.closest(".pk-field")?.classList.contains("pk-field--ok")).toBe(true);
    expect(describedBy(pattern)).toBe("A regular expression.");

    // A cross-field rule lands on the control the contract names.
    setValue(controlFor(root, "Min length") as HTMLInputElement, "50");
    const maxLength = controlFor(root, "Max length") as HTMLInputElement;
    setValue(maxLength, "40");
    expect(maxLength.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(maxLength)).toContain("maxLength must not be below minLength");
  });

  it("marks the JSON control invalid, in place, when it cannot be parsed", () => {
    const { root } = mountEditor(draft({ fieldType: "text", rawMode: true, rawValidationText: "{}" }));

    setValue(controlFor(root, "Validation JSON") as HTMLTextAreaElement, "{ not json");
    click(button(root, "Visual"));

    // The editor stays where the operator is, rather than silently discarding
    // what they typed.
    expect(button(root, "JSON").getAttribute("aria-pressed")).toBe("true");
    expect(labelled(root, "Placeholder")).toBeNull();

    const control = controlFor(root, "Validation JSON");
    expect(control.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
    expect(control.getAttribute("aria-invalid")).toBe("true");

    // The failure is announced, and it is announced as the description of the
    // control that caused it — not as an unattached banner somewhere above.
    const messageId = control.getAttribute("aria-describedby");
    const message = messageId ? document.getElementById(messageId) : null;
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("Not valid JSON");
    expect(describedBy(control)).not.toContain("Switch to Visual");
  });

  it("clears the invalid state once the JSON parses", () => {
    const { root } = mountEditor(draft({ fieldType: "text", rawMode: true, rawValidationText: "{ not json" }));

    click(button(root, "Visual"));
    expect(controlFor(root, "Validation JSON").getAttribute("aria-invalid")).toBe("true");

    setValue(controlFor(root, "Validation JSON") as HTMLTextAreaElement, '{"helpText":"Fixed"}');
    click(button(root, "Visual"));

    expect((controlFor(root, "Help text") as HTMLInputElement).value).toBe("Fixed");
  });
});

describe("buildFieldValidation", () => {
  it("keeps only the keys the field type supports, as rules the contract accepts", () => {
    const built = buildFieldValidation(
      draft({ fieldType: "text", placeholder: "e.g. blue", minItems: "2", maxLength: "40" }),
    );
    // What the parent sends as `validation` has to satisfy the rules schema
    // the route parses it with; a literal comparison alone would not say so.
    expect(formFieldRulesSchema.parse(built)).toEqual({ placeholder: "e.g. blue", maxLength: 40 });
  });

  it("returns undefined when nothing was configured", () => {
    expect(buildFieldValidation(draft())).toBeUndefined();
    expect(buildFieldValidation(draft({ rawMode: true, rawValidationText: "{}" }))).toBeUndefined();
  });

  it("rejects raw JSON that is not an object, naming the field", () => {
    expect(() => buildFieldValidation(draft({ rawMode: true, rawValidationText: "[1,2]" }))).toThrow(
      /Favourite colour: validation must be a JSON object/,
    );
  });

  it("propagates a syntax error from raw JSON rather than saving a partial config", () => {
    expect(() => buildFieldValidation(draft({ rawMode: true, rawValidationText: "{ not json" }))).toThrow(SyntaxError);
  });

  it("ignores a non-numeric limit instead of writing NaN into the payload", () => {
    const built = buildFieldValidation(draft({ fieldType: "number" as FieldType, min: "abc", max: "10" }));
    expect(built).toEqual({ max: 10 });
  });
});
