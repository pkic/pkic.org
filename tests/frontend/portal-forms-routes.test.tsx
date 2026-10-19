// @vitest-environment jsdom
/**
 * The global Forms pages: the list, creation as a page of its own, and where
 * creation, cancelling and a reader without write access each lead. The list
 * and the editor are covered where they live; this is the routing between them.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Forms } from "../../assets/ts/member-flows/portal/sections/Forms";
import { formCreateResponseSchema, formsListResponseSchema } from "../../assets/shared/schemas/form-management";
import { fillQuestion, nameForm } from "./helpers/form-editor";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: preact.VNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  navigate.mockReset();
  vi.unstubAllGlobals();
});

describe("global forms routes", () => {
  it("opens creation from the list's action, as a page that replaces the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(formsListResponseSchema.parse({ forms: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })),
      ),
    );
    const list = mount(<Forms canWrite />);
    await settle();
    await act(async () => button(list, "New form")!.click());
    expect(navigate).toHaveBeenCalledWith("/forms/new");

    const creation = mount(<Forms formKey="new" canWrite />);
    await settle();
    expect(creation.querySelector("table")).toBeNull();
    expect(button(creation, "New form")).toBeUndefined();

    await act(async () => button(creation, "← All forms")!.click());
    expect(navigate).toHaveBeenLastCalledWith("/forms");
  });

  it("goes straight to the created form's own page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          formCreateResponseSchema.parse({
            success: true,
            formId: "00000000-0000-4000-8000-000000000009",
            placementId: "00000000-0000-4000-8000-000000000010",
            key: "new-member-form",
          }),
          201,
        ),
      ),
    );
    const creation = mount(<Forms formKey="new" canWrite />);
    await settle();
    await nameForm(creation, "New member form", "new-member-form");
    await fillQuestion(creation, "Feedback", "feedback");
    await act(async () => {
      creation.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(navigate).toHaveBeenCalledWith("/forms/new-member-form");
  });

  it("returns a reader who cannot write from the creation address to the list", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mount(<Forms formKey="new" canWrite={false} />);
    await settle();

    expect(navigate).toHaveBeenCalledWith("/forms");
  });
});
