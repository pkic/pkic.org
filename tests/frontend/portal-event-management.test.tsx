// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, GROUP_ID, json, mount, responseEvent, settle } from "./helpers/event-management";
import { GroupEventEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupEventEditor";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
import { buttonNamed, controlFor, groupNames, submitForm, typeInto } from "./helpers/labelled-control";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("portal event management", () => {
  it("does not advertise registration for a no-registration event", () => {
    const container = mount(
      <GroupEventWorkspace
        event={{ ...responseEvent, basePath: "/events/no-registration-event/", capabilities: ["view", "register"] }}
        groupId={GROUP_ID}
      />,
    );

    expect(container.textContent).not.toContain("Open registration");
    expect(container.textContent).not.toContain("Registration is available");
  });

  it("preserves input entered before mount effects finish", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ profiles: [] })),
    );
    const container = mount(<GroupEventEditor groupId={GROUP_ID} event={null} onSaved={vi.fn()} />);
    // Resolved through the label's own `for`/`id` pair rather than a
    // hand-written id, so the lookup fails exactly when the accessibility
    // contract is broken — which is the thing worth asserting.
    const name = controlFor(container, "Event name");
    name.value = "Fast architecture workshop";
    name.dispatchEvent(new Event("input", { bubbles: true }));

    await settle();

    expect(name.value).toBe("Fast architecture workshop");
    expect(controlFor(container, "Slug").value).toBe("fast-architecture-workshop");
  });

  it("names every control it asks for, and marks the two the contract requires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ profiles: [{ key: "workshop", label: "Workshop", description: null, standaloneEligible: true }] }),
      ),
    );
    const container = mount(<GroupEventEditor groupId={GROUP_ID} event={null} onSaved={vi.fn()} />);
    await settle();

    // Every name the form announces resolves to a real control: `controlFor`
    // throws when a label points at nothing, which is the assertion.
    for (const label of ["Event name", "Slug", "Event profile", "Visibility", "Location", "Peer invitation limit"]) {
      expect(controlFor(container, label).id).not.toBe("");
    }
    expect(controlFor(container, "Event name").required).toBe(true);
    expect(controlFor(container, "Slug").required).toBe(true);

    // The link editor is several controls, so its group is named by a legend
    // rather than by a label with nothing to point at.
    expect(groupNames(container)).toContain("Links");

    // The guidance is wired to the control it explains, not merely placed
    // beside it.
    const limit = controlFor(container, "Peer invitation limit");
    const describedBy = limit.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${describedBy}`)?.textContent).toContain("Set this to 0 to disable peer");
  });

  it("blocks the create form, and says why, when the catalog offers no standalone profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ profiles: [{ key: "meeting", label: "Meeting", description: null, standaloneEligible: false }] }),
      ),
    );
    const container = mount(<GroupEventEditor groupId={GROUP_ID} event={null} onSaved={vi.fn()} />);
    await settle();

    // An empty catalog is not the contract's verdict on a value, so the
    // select is not marked invalid; the condition is announced beside the
    // form it blocks, and Create stays out of reach.
    const profile = controlFor<HTMLSelectElement>(container, "Event profile");
    expect(profile.getAttribute("aria-invalid")).toBeNull();
    expect(profile.disabled).toBe(true);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("No standalone event profiles are currently available.");
    expect(buttonNamed(container, "Create event").disabled).toBe(true);
  });

  it("refuses a name the contract rejects at the field, live, and creates nothing", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push(init.method ?? "GET");
        return json({
          profiles: [{ key: "workshop", label: "Workshop", description: null, standaloneEligible: true }],
        });
      }),
    );
    const container = mount(<GroupEventEditor groupId={GROUP_ID} event={null} onSaved={vi.fn()} />);
    await settle();

    // Refused as typed: the contract wants at least three characters, and the
    // field says so before anything is sent.
    const name = controlFor(container, "Event name");
    await typeInto(name, "ab");
    const field = name.closest(".pk-field");
    expect(field?.classList.contains("pk-field--invalid")).toBe(true);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector(`#${name.getAttribute("aria-describedby")}`)?.getAttribute("role")).toBe("alert");

    await submitForm(container);
    await settle();
    expect(requests.filter((method) => method === "POST")).toHaveLength(0);
    // The refused field holds focus so the reader is taken to it.
    expect(document.activeElement).toBe(name);

    // Corrected: the same field says it is good now.
    await typeInto(name, "Architecture workshop");
    expect(field?.classList.contains("pk-field--ok")).toBe(true);
  });

  it("marks the field a server refusal names, and keeps the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "POST") {
          return new Response(
            JSON.stringify({
              error: {
                code: "VALIDATION",
                message: "Invalid request",
                details: { fieldErrors: { slug: ["That address is already taken."] } },
              },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        return json({
          profiles: [{ key: "workshop", label: "Workshop", description: null, standaloneEligible: true }],
        });
      }),
    );
    const onSaved = vi.fn();
    const container = mount(<GroupEventEditor groupId={GROUP_ID} event={null} onSaved={onSaved} />);
    await settle();

    await typeInto(controlFor(container, "Event name"), "Architecture workshop");
    await submitForm(container);
    await settle();

    const slug = controlFor(container, "Slug");
    expect(slug.value).toBe("architecture-workshop");
    expect(slug.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
    const message = container.querySelector(`#${slug.getAttribute("aria-describedby")}`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("That address is already taken.");
    expect(document.activeElement).toBe(slug);
    expect(onSaved).not.toHaveBeenCalled();
    expect(buttonNamed(container, "Create event").disabled).toBe(false);
  });

  it("announces a rejected save instead of leaving the form looking as though it saved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "PATCH") {
          return new Response(JSON.stringify({ error: "Someone else changed this event." }), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        }
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = mount(<GroupEventEditor groupId={GROUP_ID} event={responseEvent} onSaved={vi.fn()} />);
    await settle();
    await submitForm(container);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Someone else changed this");
    // The transient "Saving…" status is cleared, so nothing claims the save is
    // still in flight while an error is on screen, and the form stays usable.
    expect(container.textContent).not.toContain("Saving…");
    expect(buttonNamed(container, "Save event").disabled).toBe(false);
  });
});
