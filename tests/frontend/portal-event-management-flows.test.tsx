// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, GROUP_ID, json, mount, responseEvent, settle } from "./helpers/event-management";
import { groupEventCreateSchema, groupEventSettingsUpdateSchema } from "../../assets/shared/schemas/group-events";
import { GroupEventEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupEventEditor";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
import { buttonNamed, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

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

describe("portal event management flows", () => {
  it("creates and updates events through the shared group event contracts", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body });
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/events/profiles`) {
          return json({
            profiles: [
              {
                key: "conference",
                label: "D1 conference label",
                description: "Configured conference profile",
                standaloneEligible: true,
              },
              {
                key: "workshop",
                label: "D1 workshop label",
                description: "Configured workshop profile",
                standaloneEligible: true,
              },
              {
                key: "meeting",
                label: "D1 meeting label",
                description: "Series only",
                standaloneEligible: false,
              },
            ],
          });
        }
        return json({ event: responseEvent });
      }),
    );

    const onSaved = vi.fn();
    const create = mount(<GroupEventEditor groupId={GROUP_ID} event={null} onSaved={onSaved} />);
    await settle();
    const profileSelect = controlFor<HTMLSelectElement>(create, "Event profile");
    expect(Array.from(profileSelect.options).map((option) => option.value)).toEqual(["conference", "workshop"]);
    expect(create.textContent).toContain("Configured workshop profile");
    expect(create.textContent).not.toContain("D1 meeting label");
    expect(controlFor(create, "Peer invitation limit").value).toBe("5");

    await typeInto(controlFor(create, "Event name"), "Architecture workshop");
    await settle();
    await submitForm(create);
    await settle();

    const created = requests.find(({ method }) => method === "POST");
    expect(created?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/events`);
    // Parsed through the shared request contract rather than compared field by
    // field: a literal comparison passes whatever the schema would have
    // rejected, which is the half worth checking.
    expect(groupEventCreateSchema.parse(created?.body)).toMatchObject({
      slug: "architecture-workshop",
      name: "Architecture workshop",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      inviteLimitAttendee: 5,
      links: [],
    });
    expect(onSaved).toHaveBeenCalledWith(responseEvent);

    const edit = mount(<GroupEventEditor groupId={GROUP_ID} event={responseEvent} onSaved={onSaved} />);
    await typeInto(controlFor(edit, "Peer invitation limit"), "8");
    await settle();
    await submitForm(edit);
    await settle();

    const updated = requests.find(({ method }) => method === "PATCH");
    expect(updated?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/events/${responseEvent.id}/settings`);
    expect(groupEventSettingsUpdateSchema.parse(updated?.body)).toMatchObject({
      expectedUpdatedAt: responseEvent.updatedAt,
      inviteLimitAttendee: 8,
      links: responseEvent.links,
      location: responseEvent.location,
    });
  });

  it("manages terms and attendance days from the event context with one shared event revision", async () => {
    const requests: Array<{ pathname: string; method: string; body?: unknown }> = [];
    let revision = responseEvent.updatedAt;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, method, body });
        if (url.pathname.endsWith("/forms/event_registration")) {
          return json({ eventUpdatedAt: revision, purpose: "event_registration", form: null });
        }
        if (url.pathname.endsWith("/forms/proposal_submission")) {
          return json({ eventUpdatedAt: revision, purpose: "proposal_submission", form: null });
        }
        if (url.pathname.endsWith("/available")) {
          return json({ forms: [], page: { limit: 25, offset: 0, total: 0, count: 0, hasMore: false } });
        }
        if (url.pathname.endsWith("/registration-settings")) {
          return json({ eventUpdatedAt: revision, registrationPolicy: "no_registration" });
        }
        if (url.pathname.endsWith("/terms")) {
          if (method === "PUT") {
            revision = "2026-08-01T00:00:01.000Z";
            return json({ success: true, eventUpdatedAt: revision });
          }
          return json({
            eventUpdatedAt: revision,
            terms: {
              attendee: [
                {
                  id: "term-1",
                  audience_type: "attendee",
                  term_key: "event-terms",
                  version: "1.0",
                  required: 1,
                  content_ref: "https://example.test/terms",
                  display_text: "I agree to the event terms",
                  help_text: null,
                },
              ],
              speaker: [],
              presentation: [],
            },
          });
        }
        if (url.pathname.endsWith("/days")) {
          if (method === "PUT") {
            revision = "2026-08-01T00:00:02.000Z";
            return json({
              success: true,
              eventUpdatedAt: revision,
              skipped: [],
            });
          }
          return json({ eventUpdatedAt: revision, days: [] });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const container = mount(<GroupEventWorkspace event={responseEvent} groupId={GROUP_ID} tab="settings" />);
    await settle();
    expect(container.textContent).toContain("Registration setup");
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).some(
        (input) => input.value === "I agree to the event terms",
      ),
    ).toBe(true);

    const saveTerms = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save terms",
    )!;
    await act(async () => saveTerms.click());
    await settle();
    expect(requests.find(({ pathname, method }) => pathname.endsWith("/terms") && method === "PUT")).toMatchObject({
      body: {
        expectedUpdatedAt: responseEvent.updatedAt,
        configuration: {
          attendee: [
            {
              termKey: "event-terms",
              version: "1.0",
              required: true,
              contentRef: "https://example.test/terms",
              displayText: "I agree to the event terms",
            },
          ],
          speaker: [],
          presentation: [],
        },
      },
    });

    const saveDays = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save days",
    )!;
    await act(async () => saveDays.click());
    await settle();
    expect(requests.find(({ pathname, method }) => pathname.endsWith("/days") && method === "PUT")).toMatchObject({
      body: {
        expectedUpdatedAt: "2026-08-01T00:00:01.000Z",
        configuration: { days: [] },
      },
    });

    // Opening the editor swaps the button for a heading that names the form
    // beside it, so the form is announced as "Edit event" rather than as an
    // unlabelled group of controls in the middle of the settings tab.
    await act(async () => buttonNamed(container, "Edit event").click());
    await settle();
    const heading = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).find(
      (candidate) => candidate.textContent === "Edit event",
    );
    expect(heading).toBeDefined();
    const editor = heading!.parentElement!;
    expect(editor.querySelector("form")).not.toBeNull();
    expect(controlFor(editor, "Peer invitation limit").value).toBe(String(responseEvent.inviteLimitAttendee));
    // The slug is fixed once the event exists, and the control says so itself
    // rather than only looking greyed out.
    expect(controlFor(editor, "Slug").disabled).toBe(true);
  });

  it("enables registration without custom questions and creates an exact attendee form through shared contracts", async () => {
    const requests: Array<{ pathname: string; method: string; body?: unknown }> = [];
    let revision = responseEvent.updatedAt;
    let form: {
      placement: {
        id: string;
        formId: string;
        ownerGroupId: string;
        contextType: "event";
        contextRef: string;
        audience: string;
        active: boolean;
        opensAt: null;
        closesAt: null;
        createdAt: string;
        updatedAt: string;
      };
      form: { id: string; key: string; title: string; description: null };
    } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, method, body });
        if (url.pathname.endsWith("/forms/event_registration") && method === "POST") {
          revision = "2026-08-01T00:00:02.000Z";
          form = {
            placement: {
              id: "30000000-0000-4000-8000-000000000001",
              formId: "30000000-0000-4000-8000-000000000002",
              ownerGroupId: GROUP_ID,
              contextType: "event",
              contextRef: responseEvent.id,
              audience: "attendee",
              active: true,
              opensAt: null,
              closesAt: null,
              createdAt: revision,
              updatedAt: revision,
            },
            form: {
              id: "30000000-0000-4000-8000-000000000002",
              key: "workshop-registration",
              title: "Workshop registration",
              description: null,
            },
          };
          return json({ eventUpdatedAt: revision, purpose: "event_registration", form });
        }
        if (url.pathname.endsWith("/forms/event_registration") && method === "GET") {
          return json({ eventUpdatedAt: revision, purpose: "event_registration", form: form ?? null });
        }
        if (url.pathname.endsWith("/available")) {
          return json({
            forms: form ? [form.form] : [],
            page: { limit: 25, offset: 0, total: form ? 1 : 0, count: form ? 1 : 0, hasMore: false },
          });
        }
        if (url.pathname.endsWith("/registration-settings")) {
          if (method === "PUT") {
            revision = "2026-08-01T00:00:01.000Z";
            return json({ eventUpdatedAt: revision, registrationPolicy: "optional" });
          }
          return json({ eventUpdatedAt: revision, registrationPolicy: "no_registration" });
        }
        if (url.pathname.endsWith("/terms")) {
          return json({ eventUpdatedAt: revision, terms: { attendee: [], speaker: [], presentation: [] } });
        }
        if (url.pathname.endsWith("/days")) return json({ eventUpdatedAt: revision, days: [] });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const onUpdated = vi.fn();
    const container = mount(
      <GroupEventWorkspace event={responseEvent} groupId={GROUP_ID} tab="settings" onUpdated={onUpdated} />,
    );
    await settle();

    // Resolved through the label's own for/id pair rather than through an id
    // the surface happened to compose, so the lookup fails exactly when the
    // labelling contract is broken.
    const policy = controlFor<HTMLSelectElement>(container, "Registration policy");
    policy.value = "optional";
    policy.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Save registration settings")!
        .click();
    });
    await settle();
    expect(
      requests.find(({ pathname, method }) => pathname.endsWith("/registration-settings") && method === "PUT"),
    ).toMatchObject({
      body: {
        expectedUpdatedAt: responseEvent.updatedAt,
        registrationPolicy: "optional",
      },
    });

    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Create registration form")!
      .click();
    await settle();
    // Located by the heading that names the panel, not by a framework class:
    // the name is what the surface actually promises a reader.
    const editor = Array.from(container.querySelectorAll<HTMLElement>("section.pk-panel")).find(
      (panel) => panel.querySelector(".pk-panel__title")?.textContent === "New registration form",
    )!;
    await typeInto(controlFor(editor, "Key"), "workshop-registration");
    await typeInto(controlFor(editor, "Title"), "Workshop registration");
    await settle();
    await act(async () => {
      editor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(
      requests.find(({ pathname, method }) => pathname.endsWith("/forms/event_registration") && method === "POST"),
      container.textContent ?? "",
    ).toMatchObject({
      body: {
        expectedUpdatedAt: "2026-08-01T00:00:01.000Z",
        definition: {
          key: "workshop-registration",
          title: "Workshop registration",
          status: "active",
          fields: [],
        },
      },
    });
    // The chosen form's title reads back from the closed combobox itself.
    expect(controlFor(container, "Registration questions").value).toBe("Workshop registration");
    expect(onUpdated).toHaveBeenCalledTimes(2);
  });
});
