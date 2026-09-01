// @vitest-environment jsdom
/**
 * The event-terms editor after its move onto the design system.
 *
 * The Bootstrap version drew each term as a `card` full of `col-md-*`, labeled
 * its controls with bare `form-label` spans, wrote `form-check` on the label
 * without the input and text classes that make it a real control, gave every
 * remove button the same "Remove term" name, and reported the save in a
 * `text-muted` span. These assert what replaced them: Field-bound labels, the
 * complete check triplet, remove controls that say what they remove, and a
 * result that carries a role rather than only a hue.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { groupEventTermsReplaceSchema } from "../../assets/shared/schemas/group-events";
import { EventTermsEditor } from "../../assets/ts/member-flows/portal/sections/management/EventTermsEditor";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "architecture-workshop";
const TERMS_PATH = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/terms`;

const event: GroupEvent = {
  id: EVENT_ID,
  ownerGroupId: GROUP_ID,
  seriesId: null,
  slug: EVENT_ID,
  basePath: null,
  name: "Architecture workshop",
  timezone: "Europe/Amsterdam",
  startsAt: "2026-09-01T15:00:00.000Z",
  endsAt: "2026-09-01T16:00:00.000Z",
  profileKey: "workshop",
  sourceMode: "portal",
  registrationPolicy: "no_registration",
  visibility: "group_members",
  inviteLimitAttendee: 5,
  location: "Online",
  links: [],
  nextOccurrenceAt: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "manage"],
};

const oneAttendeeTerm = {
  eventUpdatedAt: "2026-08-01T00:00:00.000Z",
  terms: {
    attendee: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        audience_type: "attendee" as const,
        term_key: "terms-of-service",
        version: "1.0",
        required: 1,
        content_ref: "https://example.test/terms",
        display_text: "I agree to the event terms",
        help_text: "Read the full text before accepting.",
      },
    ],
    speaker: [],
    presentation: [],
  },
};

const noTerms = {
  eventUpdatedAt: "2026-08-01T00:00:00.000Z",
  terms: { attendee: [], speaker: [], presentation: [] },
};

const mounted: HTMLElement[] = [];

interface Captured {
  method: string;
  body?: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function stubTerms(listed: unknown, replace: () => Response): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init.method ?? "GET";
      captured.push({ method, body: typeof init.body === "string" ? init.body : undefined });
      expect(new URL(url, location.origin).pathname).toBe(TERMS_PATH);
      return method === "PUT" ? replace() : json(listed);
    }),
  );
  return captured;
}

function mount(node: ComponentChild): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

/** `useId` emits ids a CSS selector would have to escape, and jsdom has no `CSS.escape`. */
function byId(container: HTMLElement, id: string): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id) ?? null;
}

function fieldLabels(container: HTMLElement): HTMLLabelElement[] {
  return [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
}

function labelled(container: HTMLElement, text: string): HTMLInputElement[] {
  return fieldLabels(container)
    .filter((label) => (label.textContent ?? "").startsWith(text))
    .map((label) => byId(container, label.htmlFor))
    .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement);
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => (candidate.textContent ?? "").trim() === label,
  );
  expect(found, `no button named "${label}"`).toBeDefined();
  return found!;
}

async function type(control: HTMLInputElement, value: string): Promise<void> {
  control.value = value;
  await act(() => {
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event terms editor", () => {
  it("binds every label to the control it names and gives each audience a heading", async () => {
    stubTerms(oneAttendeeTerm, () => json({ success: true, eventUpdatedAt: oneAttendeeTerm.eventUpdatedAt }));

    const container = mount(
      <EventTermsEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();

    expect(container.querySelector("form")?.classList.contains("pk")).toBe(true);

    const labels = fieldLabels(container);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(byId(container, label.htmlFor), `label "${label.textContent ?? ""}" points at nothing`).not.toBeNull();
    }

    // The three audiences are named regions with real headings, where the
    // Bootstrap version had a <summary> that emitted no outline entry at all.
    expect([...container.querySelectorAll(".pk-panel__title")].map((title) => title.textContent)).toEqual([
      "Attendee terms",
      "Speaker terms",
      "Presentation upload terms",
    ]);

    const [key] = labelled(container, "Key");
    expect(key.value).toBe("terms-of-service");
    expect(key.required).toBe(true);
    // The asterisk is decorative; the word behind it is what is announced.
    expect(labels.find((label) => (label.textContent ?? "").startsWith("Key"))?.textContent).toContain("(required)");
    expect(key.className).toContain("pk-mono");

    expect(labelled(container, "Agreement text")[0].value).toBe("I agree to the event terms");
    expect(labelled(container, "Link URL")[0].value).toBe("https://example.test/terms");
    const helpId = labelled(container, "Version")[0].getAttribute("aria-describedby") ?? "";
    expect(byId(container, helpId)?.textContent).toContain("Raise it when the wording changes");

    // A half-adopted checkbox — `pk-check` on the label with nothing on the
    // input — renders an operating-system default control and no gate sees it.
    const check = container.querySelector("label.pk-check");
    expect(check?.querySelector("input.pk-check__input")).not.toBeNull();
    expect(check?.querySelector("span.pk-check__label")?.textContent).toContain("Required");
    expect(check?.querySelector<HTMLInputElement>("input")?.checked).toBe(true);

    // Forty identical "Remove" buttons are indistinguishable control by
    // control, so each says which term of which audience it removes.
    expect(
      [...container.querySelectorAll("button")]
        .map((element) => (element.textContent ?? "").trim())
        .filter((text) => text.startsWith("Remove")),
    ).toEqual(["Remove attendee term 1"]);
  });

  it("announces an audience with nothing to accept instead of an empty box", async () => {
    stubTerms(noTerms, () => json({ success: true, eventUpdatedAt: noTerms.eventUpdatedAt }));

    const container = mount(
      <EventTermsEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();

    const empty = [...container.querySelectorAll(".pk-empty-state")];
    expect(empty).toHaveLength(3);
    expect(empty.every((element) => element.getAttribute("role") === "status")).toBe(true);
    expect(empty[0].textContent).toContain("No attendee terms");
    expect(container.querySelector(".text-muted")).toBeNull();
  });

  it("sends the shared replace contract and announces the saved revision", async () => {
    const onRevision = vi.fn();
    const captured = stubTerms(noTerms, () => json({ success: true, eventUpdatedAt: "2026-08-02T00:00:00.000Z" }));

    const container = mount(
      <EventTermsEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={onRevision} />,
    );
    await settle();

    // The label the end-to-end flow clicks; keep it exactly this wording.
    await act(() => buttonNamed(container, "Add attendee term").click());
    await type(labelled(container, "Key")[0], "code-of-conduct");
    await type(labelled(container, "Agreement text")[0], "I agree to the code of conduct");
    await submit(container);

    const put = captured.find(({ method }) => method === "PUT");
    expect(put).toBeDefined();
    // Parsed through the shared request schema, so a body that drifts from the
    // contract fails here rather than at the endpoint.
    expect(groupEventTermsReplaceSchema.parse(JSON.parse(put!.body!))).toEqual({
      expectedUpdatedAt: event.updatedAt,
      configuration: {
        attendee: [
          {
            termKey: "code-of-conduct",
            version: "1.0",
            required: true,
            displayText: "I agree to the code of conduct",
          },
        ],
        speaker: [],
        presentation: [],
      },
    });

    expect(onRevision).toHaveBeenCalledWith("2026-08-02T00:00:00.000Z");
    const announced = container.querySelector('[role="status"].pk-alert');
    expect(announced?.textContent).toContain("Terms saved.");
  });

  it("interrupts with a rejected save and leaves the form usable", async () => {
    const onRevision = vi.fn();
    stubTerms(oneAttendeeTerm, () =>
      json({ error: { code: "CONFLICT", message: "Someone else changed this event." } }, 409),
    );

    const container = mount(
      <EventTermsEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={onRevision} />,
    );
    await settle();
    await submit(container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain("pk-alert");
    expect(alert?.textContent).toContain("Someone else changed this event.");
    expect(onRevision).not.toHaveBeenCalled();
    // The conflict has to be resolvable, so nothing stays disabled.
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
    expect(container.querySelector('[role="status"].pk-alert')).toBeNull();
  });

  it("reports a failed load through the shared error alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Event management is required." } }, 403)),
    );

    const container = mount(
      <EventTermsEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Event management is required.");
    expect(container.querySelector("form")).toBeNull();
  });
});
