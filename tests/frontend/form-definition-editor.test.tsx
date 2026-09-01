// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formDefinitionCreateSchema } from "../../assets/shared/schemas/forms";
import { FormDefinitionEditor } from "../../assets/ts/components/forms/FormDefinitionEditor";
import { buttonNamed, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

/** The per-field row names its controls with aria-label, not a visible label. */
const FIELD_KEY_INPUT = 'input[aria-label="Field key (lowercase, letters, digits, underscores)"]';
const FIELD_LABEL_INPUT = 'input[aria-label="Field label"]';

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

/** The reorder and remove controls are icon-only, so aria-label is their name. */
function iconButtonNamed(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`no button is named "${label}"`);
  return match;
}

async function fillMinimalDraft(container: HTMLElement): Promise<void> {
  await typeInto(controlFor(container, "Key"), "member-survey");
  await typeInto(controlFor(container, "Title"), "Member survey");
  await typeInto(container.querySelector<HTMLElement>(FIELD_KEY_INPUT)!, "priority");
  await typeInto(container.querySelector<HTMLElement>(FIELD_LABEL_INPUT)!, "Priority");
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("form definition editor", () => {
  it("hands the shared create contract to its owner rather than a hand-built payload", async () => {
    const onSave = vi.fn().mockResolvedValue("member-survey");
    const onSaved = vi.fn();
    const container = mount(
      <FormDefinitionEditor mode="create" detail={null} onSave={onSave} onSaved={onSaved} onCancel={() => undefined} />,
    );

    await fillMinimalDraft(container);
    await submitForm(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    // The payload is asserted against the canonical schema, not against a
    // literal: a shape the schema rejects is the failure worth catching.
    const payload = formDefinitionCreateSchema.parse(onSave.mock.calls[0][0]);
    expect(payload.key).toBe("member-survey");
    expect(payload.title).toBe("Member survey");
    expect(payload.fields.map((field) => field.key)).toEqual(["priority"]);
    expect(onSaved).toHaveBeenCalledWith("member-survey");
  });

  it("announces a rejected save in place and reports it to its owner", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("That key is already taken."));
    const onSaved = vi.fn();
    const onError = vi.fn();
    const container = mount(
      <FormDefinitionEditor
        mode="create"
        detail={null}
        onSave={onSave}
        onSaved={onSaved}
        onCancel={() => undefined}
        onError={onError}
      />,
    );

    await fillMinimalDraft(container);
    await submitForm(container);

    // The failure reaches assistive technology as a live region, not as a
    // colour beside the button.
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("That key is already taken.");
    expect(onError).toHaveBeenCalledWith("That key is already taken.");
    expect(onSaved).not.toHaveBeenCalled();
    // The form stays usable after the failure so the key can be corrected.
    expect(buttonNamed(container, "Create form").disabled).toBe(false);
  });

  it("names every control, region and icon-only action it exposes", () => {
    const container = mount(
      <FormDefinitionEditor
        mode="create"
        detail={null}
        onSave={vi.fn().mockResolvedValue("k")}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );

    // Each labelled control is reachable through a real `for`/`id` pair.
    for (const label of ["Key", "Purpose", "Title", "Status", "Description"]) {
      const control = controlFor(container, label);
      expect(control.id).not.toBe("");
      expect(container.querySelector(`label[for="${control.id}"]`)?.textContent).toBe(label);
    }

    // The compact per-field row has no visible labels, so each control there
    // has to carry its own accessible name.
    expect(container.querySelector(FIELD_KEY_INPUT)).not.toBeNull();
    expect(container.querySelector(FIELD_LABEL_INPUT)).not.toBeNull();
    expect(container.querySelector('select[aria-label="Field type"]')).not.toBeNull();

    // The field row is a named region, and its reorder/remove controls are
    // buttons with names rather than bare glyphs.
    const region = container.querySelector<HTMLElement>('section[aria-label="Field 1"]');
    expect(region).not.toBeNull();
    expect(iconButtonNamed(region!, "Move field 1 up").disabled).toBe(true);
    expect(iconButtonNamed(region!, "Move field 1 down").disabled).toBe(true);
    expect(iconButtonNamed(region!, "Remove field 1").disabled).toBe(true);

    // A checkbox needs all three parts, or it renders as an operating-system
    // default control.
    const check = region!.querySelector("label.pk-check")!;
    expect(check.querySelector("input.pk-check__input")?.getAttribute("type")).toBe("checkbox");
    expect(check.querySelector("span.pk-check__label")?.textContent).toBe("Required");
  });

  it("reorders fields through the named move controls", async () => {
    const container = mount(
      <FormDefinitionEditor
        mode="create"
        detail={null}
        onSave={vi.fn().mockResolvedValue("k")}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );

    await typeInto(container.querySelector<HTMLElement>(FIELD_KEY_INPUT)!, "first");
    await act(async () => buttonNamed(container, "Add field").click());

    const keys = () => [...container.querySelectorAll<HTMLInputElement>(FIELD_KEY_INPUT)].map((input) => input.value);
    expect(keys()).toEqual(["first", ""]);

    await act(async () => iconButtonNamed(container, "Move field 2 up").click());
    expect(keys()).toEqual(["", "first"]);
  });
});
