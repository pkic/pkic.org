// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { httpUrlSchema } from "../../assets/shared/schemas/urls";
import { useContractForm } from "../../assets/ts/hooks/useContractForm";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { Field } from "../../assets/ts/ui/Field";
import { TextInput } from "../../assets/ts/ui/TextControl";
import { controlFor, typeInto } from "./helpers/labelled-control";

const contract = z.object({ name: z.string().trim().min(1), website: httpUrlSchema.nullable() });

let outcome = "";
let container: HTMLDivElement | null = null;

function Harness() {
  const [draft, setDraft] = useState({ name: "", website: "" });
  const form = useContractForm(contract, { name: draft.name, website: draft.website || null });
  return (
    <form {...form.handlers} onSubmit={(event) => event.preventDefault()}>
      <Field label="Name" {...form.of("name")}>
        {(control) => (
          <TextInput
            {...control}
            name="name"
            value={draft.name}
            onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })}
          />
        )}
      </Field>
      <Field label="Website" {...form.of("website")}>
        {(control) => (
          <TextInput
            {...control}
            name="website"
            type="url"
            value={draft.website}
            onInput={(e) => setDraft({ ...draft, website: (e.target as HTMLInputElement).value })}
          />
        )}
      </Field>
      <button
        type="button"
        onClick={() => {
          const checked = form.submit();
          outcome = checked.data ? `sent ${JSON.stringify(checked.data)}` : checked.message;
        }}
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          outcome = form.refuse(
            new ApiClientError(
              {
                error: {
                  code: "VALIDATION",
                  message: "Invalid request",
                  details: { fieldErrors: { website: ["That host is not allowed."] } },
                },
              },
              400,
            ),
          );
        }}
      >
        Refuse
      </button>
    </form>
  );
}

function mount(): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(<Harness />, container!));
  return container;
}

function fieldOf(control: HTMLElement): HTMLElement {
  return control.closest<HTMLElement>(".pk-field")!;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  outcome = "";
});

describe("useContractForm", () => {
  it("shows nothing until a field is touched, then the contract's verdict on that field alone", async () => {
    const root = mount();
    // The body is invalid from the start (no name), but an untouched form is
    // not covered in red.
    expect(root.querySelector(".pk-field--invalid")).toBeNull();

    const website = controlFor(root, "Website");
    await typeInto(website, "rss please");
    expect(fieldOf(website).classList.contains("pk-field--invalid")).toBe(true);
    expect(website.getAttribute("aria-invalid")).toBe("true");
    expect(fieldOf(website).querySelector('[role="alert"]')?.textContent).toContain("web address");
    // The other field is still untouched and still says nothing.
    expect(fieldOf(controlFor(root, "Name")).className).toBe("pk-field");

    await typeInto(website, "https://example.test");
    expect(fieldOf(website).classList.contains("pk-field--ok")).toBe(true);
  });

  it("refuses a submission at every field the contract refuses, focusing the first", async () => {
    const root = mount();
    await typeInto(controlFor(root, "Website"), "https://example.test");
    await act(async () => root.querySelector<HTMLButtonElement>("button")!.click());
    expect(outcome).toBe("Please correct the highlighted fields.");
    const name = controlFor(root, "Name");
    expect(fieldOf(name).classList.contains("pk-field--invalid")).toBe(true);
    expect(document.activeElement).toBe(name);

    await typeInto(name, "Example");
    await act(async () => root.querySelector<HTMLButtonElement>("button")!.click());
    // What is sent is the contract's own output: trimmed, typed, normalized.
    expect(outcome).toBe('sent {"name":"Example","website":"https://example.test"}');
  });

  it("marks the field a server refusal names, and lifts the mark when it is retyped", async () => {
    const root = mount();
    const website = controlFor(root, "Website");
    await typeInto(website, "https://example.test");
    await act(async () => [...root.querySelectorAll("button")][1].click());
    expect(outcome).toBe("Invalid request");
    expect(fieldOf(website).querySelector('[role="alert"]')?.textContent).toContain("That host is not allowed.");
    expect(document.activeElement).toBe(website);

    await typeInto(website, "https://other.test");
    expect(fieldOf(website).classList.contains("pk-field--ok")).toBe(true);
  });
});
