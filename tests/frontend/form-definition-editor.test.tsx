// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formDefinitionCreateSchema } from "../../assets/shared/schemas/forms";
import { FormDefinitionEditor } from "../../assets/ts/components/forms/FormDefinitionEditor";
import { buttonNamed, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

/** The per-field row names its controls with aria-label, not a visible label. */
const FIELD_LABEL_INPUT = 'input[placeholder="What are you asking?"]';
const FORM_TITLE_INPUT = 'input[aria-label="Form title"]';

/**
 * Opens a question's "Key and reporting" fold and returns its key input.
 *
 * The key is no longer a column in a compact row; it sits behind the fold that
 * groups it with the reporting settings, so reaching it takes the same step a
 * person takes.
 */
function fieldKeyInput(root: HTMLElement): HTMLInputElement {
  const summary = [...root.querySelectorAll<HTMLButtonElement>("button.pk-fold__summary")].find((candidate) =>
    (candidate.textContent ?? "").includes("Key and reporting"),
  );
  if (!summary) throw new Error("no key and reporting fold");
  if (summary.getAttribute("aria-expanded") !== "true") {
    void act(() => summary.click());
  }
  const label = [...root.querySelectorAll("label")].find((entry) => entry.textContent?.trim() === "Field key");
  const input = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error("no field key control");
  return input;
}

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
  // The title is what names the form; the key follows from it.
  await typeInto(container.querySelector<HTMLElement>(FORM_TITLE_INPUT)!, "Member survey");
  await typeInto(container.querySelector<HTMLElement>(FIELD_LABEL_INPUT)!, "Priority");
  await typeInto(fieldKeyInput(container), "priority");
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

    // The settings rail keeps real `for`/`id` pairs.
    for (const label of ["Purpose", "Status"]) {
      const control = controlFor(container, label);
      expect(control.id).not.toBe("");
      expect(container.querySelector(`label[for="${control.id}"]`)?.textContent).toBe(label);
    }

    /*
     * The title and description are edited in place, so they carry no visible
     * label — the value is its own heading. That makes an accessible name the
     * only thing naming them, which is why it is asserted here.
     */
    expect(container.querySelector(FORM_TITLE_INPUT)).not.toBeNull();
    expect(container.querySelector('textarea[aria-label="Form description"]')).not.toBeNull();

    // The question's own controls are labelled.
    expect(controlFor(container, "Question")).not.toBeNull();
    expect(controlFor(container, "Answer type")).not.toBeNull();
    expect(fieldKeyInput(container)).not.toBeNull();

    // The open question is a named region, and its reorder controls are
    // buttons with names rather than bare glyphs.
    const region = container.querySelector<HTMLElement>('section[aria-label="Question 1"]');
    expect(region).not.toBeNull();
    expect(iconButtonNamed(region!, "Move question 1 up").disabled).toBe(true);
    expect(iconButtonNamed(region!, "Move question 1 down").disabled).toBe(true);
    expect(buttonNamed(region!, "Delete").disabled).toBe(true);

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

    await typeInto(container.querySelector<HTMLElement>(FIELD_LABEL_INPUT)!, "First");
    // A question is added by choosing its answer type, which is also what
    // opens the new card.
    await act(async () => iconButtonNamed(container, "Paragraph").click());

    // Only the open card shows its editors, so the closed one is read from the
    // summary row the author scans.
    const labels = () => [
      ...container.querySelectorAll<HTMLElement>(
        ".pk-formq .pk-strong, .pk-formq-open input[placeholder='What are you asking?']",
      ),
    ];
    expect(labels()).toHaveLength(2);

    await act(async () => iconButtonNamed(container, "Move question 2 up").click());
    const first = container.querySelector<HTMLElement>(".pk-formq .pk-strong");
    expect(first?.textContent).toBe("Untitled question");
  });
});
