// @vitest-environment jsdom
/**
 * The create-role view on its own: what it sends, what it says when the server
 * refuses, and what it exposes to a reader who never sees the layout.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { roleCreateSchema } from "../../assets/shared/schemas/access-control";
import { RoleCreate } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleCreate";

const mounted: HTMLElement[] = [];

function mount(node: preact.ComponentChildren): HTMLElement {
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
  vi.unstubAllGlobals();
});

/** Located through the label that names it, which is what a reader has too. */
function labeledControl<T extends HTMLElement>(container: HTMLElement, label: string): T {
  const element = [...container.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  const control = element?.htmlFor ? container.querySelector<T>(`[id="${element.htmlFor}"]`) : null;
  if (!control) throw new Error(`no control labeled: ${label}`);
  return control;
}

function type(control: HTMLInputElement, value: string): void {
  void act(() => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function role(overrides: Record<string, unknown> = {}) {
  return {
    id: "role-created-1",
    name: "sponsorship_lead",
    description: "Runs sponsorship",
    isSystemRole: false,
    permissions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("RoleCreate", () => {
  it("posts a body the shared create contract accepts and hands back the new role id", async () => {
    let captured: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : String(input), location.origin);
        if (url.pathname !== "/api/v1/roles" || init?.method !== "POST") {
          throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`);
        }
        captured = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ role: role() }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const onCreated = vi.fn();
    const container = mount(<RoleCreate onCreated={onCreated} onCancel={vi.fn()} />);

    type(labeledControl<HTMLInputElement>(container, "Name"), "  sponsorship_lead  ");
    type(labeledControl<HTMLInputElement>(container, "Description"), "Runs sponsorship");
    await submit(container);

    // Parsed through the contract rather than compared field by field: a
    // literal comparison passes even when the schema has moved on.
    const parsed = roleCreateSchema.parse(captured);
    expect(parsed.name).toBe("sponsorship_lead");
    expect(parsed.description).toBe("Runs sponsorship");
    expect(onCreated).toHaveBeenCalledWith("role-created-1");
  });

  it("keeps a rejected submission on screen, in words, and does not navigate away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "CONFLICT", message: "A role with that name exists" } }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const onCreated = vi.fn();
    const container = mount(<RoleCreate onCreated={onCreated} onCancel={vi.fn()} />);

    type(labeledControl<HTMLInputElement>(container, "Name"), "sponsorship_lead");
    await submit(container);

    // role="alert" rather than a toast: the sentence stays beside the control
    // it is about, and is announced without moving focus out of the form.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("A role with that name exists");
    expect(onCreated).not.toHaveBeenCalled();
    // The button is not left spinning after the failure.
    const create = [...container.querySelectorAll("button")].find((b) => b.textContent === "Create role")!;
    expect(create.getAttribute("aria-busy")).toBeNull();
  });

  it("marks an identifier the contract cannot accept as invalid, and sends nothing", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("no request expected");
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = mount(<RoleCreate onCreated={vi.fn()} onCancel={vi.fn()} />);

    const name = labeledControl<HTMLInputElement>(container, "Name");
    type(name, "Sponsorship Lead");

    expect(name.getAttribute("aria-invalid")).toBe("true");
    // The reason is announced with the control rather than only coloured.
    const messageId = name.getAttribute("aria-describedby")!;
    expect(container.querySelector(`[id="${messageId}"]`)?.textContent).toContain("Lowercase letters");

    await submit(container);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Lowercase letters");
  });

  it("names the form and pairs every label with the control it names", () => {
    const container = mount(<RoleCreate onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(container.querySelector("form")?.getAttribute("aria-label")).toBe("New role");
    // The permission checkboxes are a group of controls, so they are named by
    // a legend rather than by a label pointing at nothing.
    const legends = [...container.querySelectorAll("legend")].map((legend) => legend.textContent);
    expect(legends).toContain("Permissions");

    const nameControl = labeledControl<HTMLInputElement>(container, "Name");
    expect(nameControl.required).toBe(true);
    // A valid-but-empty field is unfinished, not wrong.
    expect(nameControl.getAttribute("aria-invalid")).toBeNull();
    const helpId = nameControl.getAttribute("aria-describedby")!;
    expect(container.querySelector(`[id="${helpId}"]`)?.textContent).toBe(
      "Lowercase letters, numbers, and underscores only, starting with a letter.",
    );
  });

  it("leaves without creating anything when the view is cancelled", () => {
    const onCancel = vi.fn();
    const container = mount(<RoleCreate onCreated={vi.fn()} onCancel={onCancel} />);
    const cancel = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
    void act(() => cancel.click());
    expect(onCancel).toHaveBeenCalled();
  });
});
