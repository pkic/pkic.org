// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setFieldMessage } from "../../assets/ts/shared/form/validation-map";
import { Field } from "../../assets/ts/ui/Field";
import { TextInput } from "../../assets/ts/ui/TextControl";

let container: HTMLDivElement | null = null;
function mount(node: preact.VNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}
afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("Field with a validator's message slot", () => {
  it("keeps the caller's id, names the empty slot from the first paint, and shows what a validator writes", () => {
    const root = mount(
      <Field id="speaker-email" label="Email" help="Work address." errorSlot="email">
        {(control) => <TextInput {...control} name="email" type="email" />}
      </Field>,
    );
    const input = root.querySelector("input")!;
    const slot = root.querySelector<HTMLElement>("[data-field-error]")!;
    expect(input.id).toBe("speaker-email");
    expect(root.querySelector("label")?.getAttribute("for")).toBe("speaker-email");
    expect(slot.hidden).toBe(true);
    expect(slot.getAttribute("data-field-error")).toBe("email");
    // Help and the slot are both named, so a message that lands later is announced.
    const describedBy = input.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy).toContain(slot.id);
    expect(root.querySelector("#" + describedBy.find((id) => id !== slot.id))?.textContent).toBe("Work address.");
    expect(root.querySelector(".pk-field")?.className).toBe("pk-field");

    // The DOM-driven validator writes into the slot and moves the field's state.
    setFieldMessage(slot, "Enter a valid email address.", "invalid");
    expect(slot.hidden).toBe(false);
    expect(slot.textContent).toBe("Enter a valid email address.");
    expect(root.querySelector(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);

    setFieldMessage(slot, "");
    expect(slot.hidden).toBe(true);
    expect(root.querySelector(".pk-field")?.classList.contains("pk-field--invalid")).toBe(false);
  });

  it("renders no slot and no caller id when neither is asked for", () => {
    const root = mount(<Field label="Name">{(control) => <TextInput {...control} />}</Field>);
    expect(root.querySelector("[data-field-error]")).toBeNull();
    expect(root.querySelector("input")?.id).toMatch(/-control$/);
  });
});
