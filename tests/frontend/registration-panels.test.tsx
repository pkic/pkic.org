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

function apiError(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
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

    await act(async () => {
      select.value = "speaker";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
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

    const select = controlFor<HTMLSelectElement>("Role override");
    await act(async () => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await act(async () => button("Save")?.click());
    await settle();

    const patch = requests.find((request) => request.method === "PATCH");
    expect(registrationBadgePatchSchema.parse(patch?.body)).toEqual({ role: null });
  });

  it("reports a rejected save on the control instead of a bare red sentence", async () => {
    stubFetch(({ method }) =>
      method === "PATCH"
        ? apiError("FORBIDDEN", "You cannot override the badge role for this event.", 403)
        : json({ ...badge }),
    );

    mount(<BadgeRolePanel slug={SLUG} regId={REG_ID} />);
    await settle();
    await act(async () => button("Save")?.click());
    await settle();

    const select = controlFor<HTMLSelectElement>("Role override");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(select);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("You cannot override the badge role for this event.");
  });
});

describe("registration email editor", () => {
  it("names the icon-only edit control and warns before the address is changed", async () => {
    const requests = stubFetch(() => json({ success: true, registration: null, emailChanged: true }));
    const onSaved = vi.fn();

    mount(
      <RegistrationEmailEditor
        email="old@example.test"
        slug={SLUG}
        regId={REG_ID}
        isCancelled={false}
        onSaved={onSaved}
      />,
    );

    // A pencil glyph is not a name; the button carries one.
    const edit = buttonNamed("Change the registration email address, currently old@example.test");
    expect(edit).toBeInstanceOf(HTMLButtonElement);
    await act(async () => edit?.click());
    await settle();

    const input = controlFor<HTMLInputElement>("Email address");
    expect(input.type).toBe("email");
    // The consequence is an advisory, so it is described without the control
    // being announced as invalid.
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(input)?.textContent).toContain("require re-confirmation");

    await act(async () => {
      input.value = "New@Example.test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    await act(async () => button("Save")?.click());
    await settle();

    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.url.pathname).toBe(REGISTRATION_PATH);
    expect(eventRegistrationManagementUpdateSchema.parse(patch?.body)).toMatchObject({
      action: "update",
      email: "new@example.test",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("says a cancelled registration will be restored before the address is changed", async () => {
    stubFetch(() => json({ success: true, registration: null }));

    mount(
      <RegistrationEmailEditor email="old@example.test" slug={SLUG} regId={REG_ID} isCancelled onSaved={vi.fn()} />,
    );
    await act(async () => buttonNamed("Change the registration email address, currently old@example.test")?.click());
    await settle();

    expect(describedBy(controlFor<HTMLInputElement>("Email address"))?.textContent).toContain(
      "restore this cancelled registration",
    );
  });

  it("keeps the editor open and marks the field invalid when the server refuses", async () => {
    const onSaved = vi.fn();
    stubFetch(() => apiError("CONFLICT", "That address already belongs to another registration.", 409));

    mount(
      <RegistrationEmailEditor
        email="old@example.test"
        slug={SLUG}
        regId={REG_ID}
        isCancelled={false}
        onSaved={onSaved}
      />,
    );
    await act(async () => buttonNamed("Change the registration email address, currently old@example.test")?.click());
    await settle();

    const input = controlFor<HTMLInputElement>("Email address");
    await act(async () => {
      input.value = "taken@example.test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    await act(async () => button("Save")?.click());
    await settle();

    const stillOpen = controlFor<HTMLInputElement>("Email address");
    expect(stillOpen.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(stillOpen);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("That address already belongs to another registration.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("closes without a request when the address is unchanged", async () => {
    const requests = stubFetch(() => json({ success: true, registration: null }));

    mount(
      <RegistrationEmailEditor
        email="old@example.test"
        slug={SLUG}
        regId={REG_ID}
        isCancelled={false}
        onSaved={vi.fn()}
      />,
    );
    await act(async () => buttonNamed("Change the registration email address, currently old@example.test")?.click());
    await settle();
    await act(async () => button("Save")?.click());
    await settle();

    expect(requests).toHaveLength(0);
    expect(buttonNamed("Change the registration email address, currently old@example.test")).toBeInstanceOf(
      HTMLButtonElement,
    );
  });
});
