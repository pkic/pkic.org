// @vitest-environment jsdom
/**
 * The shared "answer a form" surface.
 *
 * Two things a visual check cannot show: that a failed submission is
 * announced rather than only tinted red, and that the two outcomes are told
 * apart by their role — a confirmation is polite, a failure interrupts.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormFieldDefinition } from "../../assets/shared/schemas/forms";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { FormSubmissionForm } from "../../assets/ts/components/forms/FormSubmissionForm";
import { buttonNamed, typeInto } from "./helpers/labeled-control";

const mounted: HTMLElement[] = [];

function field(key: string, label: string): FormFieldDefinition {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    key,
    label,
    fieldType: "text",
    required: false,
    options: null,
    optionSource: null,
    validation: null,
    sortOrder: 0,
    updatedAt: "2026-08-27T00:00:00.000Z",
    archivedAt: null,
  };
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container));
  mounted.push(container);
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("form submission form", () => {
  it("submits the answers and confirms politely", async () => {
    const answers: Array<Record<string, unknown>> = [];
    const container = mount(
      <FormSubmissionForm
        fields={[field("reason", "Why are you interested?")]}
        onSubmit={(value) => {
          answers.push(value);
          return Promise.resolve();
        }}
      />,
    );

    await typeInto(container.querySelector<HTMLInputElement>("#custom-reason")!, "Because PKI.");
    await act(() => buttonNamed(container, "Submit response").click());
    await settle();

    expect(answers).toEqual([{ reason: "Because PKI." }]);
    // A confirmation is announced without interrupting; only a failure does
    // that. Both carry words, so neither depends on its tone to be read.
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Response submitted.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("refuses an unanswered required question on the question itself, before anything is sent", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const container = mount(
      <FormSubmissionForm
        fields={[{ ...field("reason", "Why are you interested?"), required: true }]}
        onSubmit={onSubmit}
      />,
    );

    await act(() => buttonNamed(container, "Submit response").click());
    await settle();

    expect(onSubmit).not.toHaveBeenCalled();
    const row = container.querySelector('[data-custom-field-key="reason"]')!;
    expect(row.classList.contains("pk-field--invalid")).toBe(true);
    expect(row.querySelector("[data-field-error]")?.textContent).toContain("Why are you interested? is required");
    expect(container.querySelector<HTMLInputElement>("#custom-reason")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("marks the question a server refusal names", async () => {
    const container = mount(
      <FormSubmissionForm
        fields={[field("reason", "Why are you interested?")]}
        onSubmit={() =>
          Promise.reject(
            new ApiClientError(
              {
                error: {
                  code: "VALIDATION_ERROR",
                  message: "Answer the highlighted questions.",
                  details: { fieldErrors: { reason: ["Say a little more."] } },
                },
              },
              400,
            ),
          )
        }
      />,
    );

    await typeInto(container.querySelector<HTMLInputElement>("#custom-reason")!, "PKI");
    await act(() => buttonNamed(container, "Submit response").click());
    await settle();

    expect(container.querySelector('[data-field-error="reason"]')?.textContent).toContain("Say a little more.");
  });

  it("announces a rejected submission as an alert and does not claim success", async () => {
    const container = mount(
      <FormSubmissionForm
        fields={[field("reason", "Why are you interested?")]}
        onSubmit={() => Promise.reject(new Error("The form is closed."))}
      />,
    );

    await act(() => buttonNamed(container, "Submit response").click());
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("The form is closed.");
    expect(container.textContent).not.toContain("Response submitted.");
    // The control is usable again rather than left spinning after a failure.
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    expect(submit?.hasAttribute("aria-busy")).toBe(false);
  });
});
