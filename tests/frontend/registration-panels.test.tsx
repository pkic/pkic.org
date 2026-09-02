// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registrationBadgePatchSchema } from "../../assets/shared/schemas/participant-roles";
import { eventRegistrationManagementUpdateSchema } from "../../assets/shared/schemas/route-contracts-event-registration-management";
import {
  BadgeRolePanel,
  RegistrationEmailEditor,
} from "../../assets/ts/member-flows/portal/sections/events/detail/registration-detail/RegistrationPanels";

const SLUG = "event-2026";
const REG_ID = "00000000-0000-4000-8000-0000000000aa";
const BADGE_PATH = `/api/v1/events/${SLUG}/registrations/${REG_ID}/badge`;
const REGISTRATION_PATH = `/api/v1/events/${SLUG}/registrations/${REG_ID}`;

const badge = {
  admin_override: null,
  auto_detected: "attendee" as const,
  effective_role: "attendee" as const,
  available_roles: ["attendee", "speaker", "moderator"] as const,
};

interface Captured {
  method: string;
  url: URL;
  body: unknown;
}

let container: HTMLElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function apiError(code: string, message: string, status: number, details?: unknown): Response {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

/** A validation refusal the way the route reports one: the field it names. */
function fieldRefusal(field: string, message: string): Response {
  return apiError("VALIDATION", "Invalid request", 400, { fieldErrors: { [field]: [message] } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(node: preact.ComponentChild): void {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
}

function stubFetch(handler: (captured: Captured) => Response): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const entry: Captured = {
        method: init?.method ?? "GET",
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      captured.push(entry);
      return handler(entry);
    }),
  );
  return captured;
}

function button(label: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.getAttribute("aria-label") === name,
  );
}

/** The control a visible label actually points at, found through `for`/`id`. */
function controlFor<T extends HTMLElement>(labelText: string): T {
  const label = [...(container?.querySelectorAll("label") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === labelText,
  );
  expect(label, `no label reading "${labelText}"`).toBeInstanceOf(HTMLLabelElement);
  const id = label?.getAttribute("for");
  expect(id, `the label "${labelText}" points at nothing`).toBeTruthy();
  const control = container?.querySelector<T>(`[id="${id ?? ""}"]`);
  expect(control, `the label "${labelText}" points at a control that is not rendered`).toBeTruthy();
  return control!;
}

function describedBy(control: HTMLElement): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[id="${control.getAttribute("aria-describedby") ?? ""}"]`) ?? null;
}

function fieldOf(control: HTMLElement): HTMLElement {
  const field = control.closest<HTMLElement>(".pk-field");
  if (!field) throw new Error("control is not inside a Field");
  return field;
}

async function typeInto(control: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("registration badge role panel", () => {
  it("labels the override control and sends a patch the shared contract accepts", async () => {
    const requests = stubFetch(({ method }) =>
      method === "PATCH"
        ? json({ ...badge, admin_override: "speaker", effective_role: "speaker" })
        : json({ ...badge }),
    );

    mount(<BadgeRolePanel slug={SLUG} regId={REG_ID} />);
    await settle();

    const select = controlFor<HTMLSelectElement>("Role override");
    expect(select.tagName).toBe("SELECT");
    expect(select.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(select)?.textContent).toContain("Leave on Auto");
    // The forced/auto distinction is words, not the badge's color.
    expect(container?.textContent).toContain("Auto-detected from this registration.");

    await choose(select, "speaker");
    await act(async () => button("Save")?.click());
    await settle();

    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.url.pathname).toBe(BADGE_PATH);
    // Validated against the endpoint's own request schema rather than compared
    // to a literal, which would only restate what the component sent.
    expect(registrationBadgePatchSchema.parse(patch?.body)).toEqual({ role: "speaker" });
    expect(container?.textContent).toContain("Forced by an organizer; auto-detection would give Attendee.");
  });

  it("clears the override by sending an explicit null rather than an empty string", async () => {
    const requests = stubFetch(({ method }) =>
      method === "PATCH"
        ? json({ ...badge })
        : json({ ...badge, admin_override: "speaker", effective_role: "speaker" }),
    );

    mount(<BadgeRolePanel slug={SLUG} regId={REG_ID} />);
    await settle();

    await choose(controlFor<HTMLSelectElement>("Role override"), "");
    await act(async () => button("Save")?.click());
    await settle();

    const patch = requests.find((request) => request.method === "PATCH");
    expect(registrationBadgePatchSchema.parse(patch?.body)).toEqual({ role: null });
  });

  it("refuses a role the contract does not know at the control, and sends nothing", async () => {
    const requests = stubFetch(() => json({ ...badge }));

    mount(<BadgeRolePanel slug={SLUG} regId={REG_ID} />);
    await settle();

    // A value the catalog never offered — a stale option, a scripted change —
    // is the contract's to refuse, before any request is made.
    const select = controlFor<HTMLSelectElement>("Role override");
    const rogue = document.createElement("option");
    rogue.value = "janitor";
    select.append(rogue);
    await choose(select, "janitor");
    await act(async () => button("Save")?.click());
    await settle();

    expect(fieldOf(select).classList.contains("pk-field--invalid")).toBe(true);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(select)?.getAttribute("role")).toBe("alert");
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
  });

  it("marks the control when the server refuses the role it names", async () => {
    stubFetch(({ method }) =>
      method === "PATCH" ? fieldRefusal("role", "That role is not available for this event.") : json({ ...badge }),
    );

    mount(<BadgeRolePanel slug={SLUG} regId={REG_ID} />);
    await settle();
    await choose(controlFor<HTMLSelectElement>("Role override"), "speaker");
    await act(async () => button("Save")?.click());
    await settle();

    const select = controlFor<HTMLSelectElement>("Role override");
    expect(fieldOf(select).classList.contains("pk-field--invalid")).toBe(true);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(select);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("That role is not available for this event.");
  });

  it("states a refusal the server does not attribute to the control as an alert beside it", async () => {
    stubFetch(({ method }) =>
      method === "PATCH"
        ? apiError("FORBIDDEN", "You cannot override the badge role for this event.", 403)
        : json({ ...badge }),
    );

    mount(<BadgeRolePanel slug={SLUG} regId={REG_ID} />);
    await settle();
    await act(async () => button("Save")?.click());
    await settle();

    // The control said nothing wrong, so it is not marked invalid; the
    // refusal is announced on its own.
    const select = controlFor<HTMLSelectElement>("Role override");
    expect(select.getAttribute("aria-invalid")).toBeNull();
    const alert = container?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You cannot override the badge role for this event.");
  });
});

describe("registration email editor", () => {
  const editName = "Change the registration email address, currently old@example.test";

  function mountEditor(onSaved = vi.fn(), isCancelled = false) {
    mount(
      <RegistrationEmailEditor
        email="old@example.test"
        slug={SLUG}
        regId={REG_ID}
        isCancelled={isCancelled}
        onSaved={onSaved}
      />,
    );
    return onSaved;
  }

  it("names the icon-only edit control and warns before the address is changed", async () => {
    const requests = stubFetch(() => json({ success: true, registration: null, emailChanged: true }));
    const onSaved = mountEditor();

    // A pencil glyph is not a name; the button carries one.
    const edit = buttonNamed(editName);
    expect(edit).toBeInstanceOf(HTMLButtonElement);
    await act(async () => edit?.click());
    await settle();

    const input = controlFor<HTMLInputElement>("Email address");
    expect(input.type).toBe("email");
    // The consequence is guidance, so it is described without the control
    // being announced as invalid.
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(input)?.textContent).toContain("require re-confirmation");

    await typeInto(input, "New@Example.test");
    await act(async () => button("Save")?.click());
    await settle();

    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.url.pathname).toBe(REGISTRATION_PATH);
    // The body is what the contract makes of the draft: normalized, not
    // merely echoed.
    expect(eventRegistrationManagementUpdateSchema.parse(patch?.body)).toMatchObject({
      action: "update",
      email: "new@example.test",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("says a cancelled registration will be restored before the address is changed", async () => {
    stubFetch(() => json({ success: true, registration: null }));
    mountEditor(vi.fn(), true);
    await act(async () => buttonNamed(editName)?.click());
    await settle();

    expect(describedBy(controlFor<HTMLInputElement>("Email address"))?.textContent).toContain(
      "restore this cancelled registration",
    );
  });

  it("refuses an address the contract rejects at the field, live, and sends nothing", async () => {
    const requests = stubFetch(() => json({ success: true, registration: null }));
    const onSaved = mountEditor();
    await act(async () => buttonNamed(editName)?.click());
    await settle();

    const input = controlFor<HTMLInputElement>("Email address");
    await typeInto(input, "not an address");
    // Refused as typed, in the contract's words, on the control.
    expect(fieldOf(input).classList.contains("pk-field--invalid")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(input)?.getAttribute("role")).toBe("alert");
    expect(describedBy(input)?.textContent).toContain("valid email address");

    await act(async () => button("Save")?.click());
    await settle();
    expect(requests).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();

    // Corrected: the same field says it is good now, and the guidance returns.
    await typeInto(input, "new@example.test");
    expect(fieldOf(input).classList.contains("pk-field--ok")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks the field when the server refuses the address it names, and keeps the editor open", async () => {
    const onSaved = vi.fn();
    stubFetch(() => fieldRefusal("email", "That address already belongs to another registration."));
    mountEditor(onSaved);
    await act(async () => buttonNamed(editName)?.click());
    await settle();

    await typeInto(controlFor<HTMLInputElement>("Email address"), "taken@example.test");
    await act(async () => button("Save")?.click());
    await settle();

    const stillOpen = controlFor<HTMLInputElement>("Email address");
    expect(fieldOf(stillOpen).classList.contains("pk-field--invalid")).toBe(true);
    expect(stillOpen.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(stillOpen);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("That address already belongs to another registration.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("states a refusal the server does not attribute to the field as an alert, and keeps the editor open", async () => {
    const onSaved = vi.fn();
    stubFetch(() => apiError("CONFLICT", "This registration was changed by someone else.", 409));
    mountEditor(onSaved);
    await act(async () => buttonNamed(editName)?.click());
    await settle();

    await typeInto(controlFor<HTMLInputElement>("Email address"), "new@example.test");
    await act(async () => button("Save")?.click());
    await settle();

    const stillOpen = controlFor<HTMLInputElement>("Email address");
    expect(stillOpen.getAttribute("aria-invalid")).toBeNull();
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "This registration was changed by someone else.",
    );
    expect(stillOpen.value).toBe("new@example.test");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("closes without a request when the address is unchanged", async () => {
    const requests = stubFetch(() => json({ success: true, registration: null }));
    mountEditor();
    await act(async () => buttonNamed(editName)?.click());
    await settle();
    await act(async () => button("Save")?.click());
    await settle();

    expect(requests).toHaveLength(0);
    expect(buttonNamed(editName)).toBeInstanceOf(HTMLButtonElement);
  });
});
