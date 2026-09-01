// @vitest-environment jsdom
/**
 * The registration policy for one managed event.
 *
 * The sentence explaining when registration can be enabled used to sit above
 * the control as loose prose, which a screen reader never connects to the
 * choice it is about; it is now the field's own guidance. The other thing
 * asserted here is the failure path: a refused save used to leave only a
 * toast, which has faded by the time the reader looks back at the control.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { groupEventRegistrationSettingsUpdateSchema } from "../../assets/shared/schemas/group-events";
import { EventRegistrationSettingsEditor } from "../../assets/ts/member-flows/portal/sections/management/EventRegistrationSettingsEditor";
import { buttonNamed, chooseOption, controlFor } from "./helpers/labelled-control";

const GROUP_ID = "00000000-0000-4000-8000-000000000010";
const EVENT_ID = "00000000-0000-4000-8000-000000000011";
const UPDATED_AT = "2026-08-01T00:00:00.000Z";
const NEXT_UPDATED_AT = "2026-08-02T00:00:00.000Z";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** Records every request so a refused save can be shown to have been sent once. */
function stub(put?: () => Response) {
  const requests: Array<{ method: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "PUT") {
        return Promise.resolve(put ? put() : json({ eventUpdatedAt: NEXT_UPDATED_AT, registrationPolicy: "optional" }));
      }
      return Promise.resolve(json({ eventUpdatedAt: UPDATED_AT, registrationPolicy: "no_registration" }));
    }),
  );
  return requests;
}

function editor(onRevision = vi.fn()) {
  return (
    <EventRegistrationSettingsEditor
      groupId={GROUP_ID}
      eventId={EVENT_ID}
      expectedUpdatedAt={UPDATED_AT}
      onRevision={onRevision}
      showFormConfiguration={false}
    />
  );
}

describe("the event registration settings editor", () => {
  it("announces the wait rather than rendering an empty region", () => {
    stub();
    const container = mount(editor());

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading registration settings…");
  });

  it("names the policy control and ties its guidance to it", async () => {
    stub();
    const container = mount(editor());
    await settle();

    const policy = controlFor<HTMLSelectElement>(container, "Registration policy");
    expect(policy.tagName).toBe("SELECT");
    // The guidance is wired to the control, not merely adjacent to it.
    const help = container.querySelector(`#${policy.getAttribute("aria-describedby")!}`);
    expect(help?.textContent).toContain("at least one required attendee term");
    expect([...policy.options].map((option) => option.textContent)).toEqual([
      "No registration",
      "Optional registration",
      "Invitation only",
      "Registration required",
      "Public registration",
    ]);
  });

  it("saves the chosen policy as the shared update contract", async () => {
    const requests = stub();
    const onRevision = vi.fn();
    const container = mount(editor(onRevision));
    await settle();

    await chooseOption(controlFor<HTMLSelectElement>(container, "Registration policy"), "optional");
    await act(async () => {
      buttonNamed(container, "Save registration settings").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const put = requests.find((request) => request.method === "PUT");
    // Parsed through the canonical contract rather than compared to a literal.
    expect(groupEventRegistrationSettingsUpdateSchema.parse(put?.body)).toEqual({
      expectedUpdatedAt: UPDATED_AT,
      registrationPolicy: "optional",
    });
    expect(onRevision).toHaveBeenCalledWith(NEXT_UPDATED_AT);
  });

  it("states a refused save on the surface and keeps the chosen policy", async () => {
    stub(() => json({ error: { code: "CONFLICT", message: "The event changed since you opened it." } }, 409));
    const onRevision = vi.fn();
    const container = mount(editor(onRevision));
    await settle();

    await chooseOption(controlFor<HTMLSelectElement>(container, "Registration policy"), "required");
    await act(async () => {
      buttonNamed(container, "Save registration settings").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Announced where it appears: the danger tone carries role="alert".
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The event changed since you opened it.");
    expect(onRevision).not.toHaveBeenCalled();
    // A failed save is a retry, not a restart: the choice survives it.
    expect(controlFor<HTMLSelectElement>(container, "Registration policy").value).toBe("required");
  });

  it("shows why the settings could not be loaded and offers no dead control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(json({ error: { code: "FORBIDDEN", message: "Event management access is required." } }, 403)),
      ),
    );
    const container = mount(editor());
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Event management access is required.");
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("HTTP 403");
  });
});
