// @vitest-environment jsdom
/**
 * What the subject of a user record may change on it.
 *
 * These controls used to be a page of their own at `#/profile`; they are now
 * the self-only panel on `#/users/<own id>`, the same record everybody else
 * reads. What is worth testing did not move with them: that the draft is
 * checked by the contract the route parses, that the organization-scoped
 * fields only appear for an organization-tied identity, and that a refused
 * save says so in words rather than in a transport status.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { SelfProfilePanel } from "../../assets/ts/member-flows/portal/sections/system-users/SelfProfilePanel";
import { profile } from "../../assets/ts/member-flows/portal/state";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/self", vi.fn()] }));

const organizationId = "00000000-0000-4000-8000-000000000010";
const contactUserId = "00000000-0000-4000-8000-000000000011";
const memberId = "00000000-0000-4000-8000-000000000014";
const alternateEmailId = "00000000-0000-4000-8000-000000000016";

let container: HTMLDivElement;
let toastArea: HTMLDivElement;

function currentProfile() {
  return myProfileSchema.parse({
    userId: contactUserId,
    emailId: null,
    email: "contact@example.test",
    emailAddresses: [
      {
        id: null,
        email: "contact@example.test",
        primary: true,
        verifiedAt: "2026-01-01T00:00:00.000Z",
        verificationMethod: "magic_link",
      },
      {
        id: alternateEmailId,
        email: "contact@example.org",
        primary: false,
        verifiedAt: "2026-01-02T00:00:00.000Z",
        verificationMethod: "magic_link",
      },
    ],
    firstName: "Contact",
    lastName: "Person",
    preferredName: null,
    jobTitle: "Officer",
    biography: null,
    links: [],
    membershipCategory: "F",
    organizationId,
    organizationName: "Example Organization",
    memberSince: "2026-01-01",
    showOnOrgProfile: true,
    headshotUrl: null,
    isOrgContact: false,
    organizationIdentities: null,
    activeIdentities: [
      {
        identityId: "00000000-0000-4000-8000-000000000031",
        memberId,
        organizationId,
        organizationName: "Example Organization",
        membershipCategory: "F",
      },
    ],
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForElement<T extends Element>(find: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const element = find();
    if (element) return element;
    await settle();
  }
  throw new Error("Expected element was not rendered.");
}

/**
 * The design-system Field owns the id that ties a label to its control, so a
 * test must not assume one: find the label by the words a user reads and
 * follow its `for`. A required field's label also carries the asterisk and the
 * screen-reader-only "(required)", which is what assistive technology
 * announces, so the visible text is compared with those stripped.
 */
function controlFor<T extends HTMLElement>(label: string): T {
  const match = Array.from(container.querySelectorAll("label")).find(
    (candidate) => (candidate.textContent ?? "").replace("*(required)", "").trim() === label,
  );
  if (!match) throw new Error(`No field labelled "${label}" was rendered.`);
  const control = document.getElementById(match.htmlFor);
  if (!control) throw new Error(`The label "${label}" points at no control.`);
  return control as T;
}

/**
 * The record decides whether the fields are open (#47), so these cases mount
 * the panel already editing — the state a reader reaches by choosing "Edit
 * profile" from the record's own menu.
 */
function renderPanel(editing = true): void {
  const current = profile.value!;
  void act(() =>
    render(
      <SelfProfilePanel
        profile={current}
        editing={editing}
        onEdit={() => {}}
        onClose={() => undefined}
        onSaved={() => Promise.resolve()}
      />,
      container,
    ),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(container, toastArea);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  toastArea.remove();
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("the self-only panel on your own user record", () => {
  it("updates the selected verified email and job title through the current-user contract", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const initial = currentProfile();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : String(input), location.origin);
        const method = init?.method ?? "GET";
        if (method === "PATCH" && url.pathname === "/api/v1/users/current") {
          const body = JSON.parse(String(init?.body));
          requests.push({ method, path: url.pathname, body });
          return json({ ...initial, emailId: alternateEmailId, email: "contact@example.org", jobTitle: body.jobTitle });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );
    profile.value = initial;
    renderPanel();
    await settle();

    const emailSelect = controlFor<HTMLSelectElement>("Email for this organization");
    expect([...emailSelect.options].map((option) => option.textContent)).toEqual([
      "contact@example.test (primary)",
      "contact@example.org",
    ]);
    emailSelect.value = alternateEmailId;
    void act(() => {
      emailSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const jobTitle = controlFor<HTMLInputElement>("Job title for this organization");
    jobTitle.value = "Organization-specific officer";
    void act(() => {
      jobTitle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = emailSelect.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    // The member contract, not the staff update: nobody administers themselves.
    expect(requests).toEqual([
      {
        method: "PATCH",
        path: "/api/v1/users/current",
        body: expect.objectContaining({ emailId: alternateEmailId, jobTitle: "Organization-specific officer" }),
      },
    ]);
    expect(profile.value).toMatchObject({
      emailId: alternateEmailId,
      email: "contact@example.org",
      jobTitle: "Organization-specific officer",
    });
  });

  it("names every control and ties the organization email select to its guidance", async () => {
    profile.value = currentProfile();
    renderPanel();
    await settle();

    // A required control announces the requirement as a word, not as a colour
    // or a bare asterisk, and is not invalid merely for being required.
    const firstName = controlFor<HTMLInputElement>("First name");
    expect(firstName.required).toBe(true);
    expect(firstName.getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector(`label[for="${firstName.id}"]`)?.textContent).toContain("(required)");

    // The select's guidance is wired, not merely adjacent: without the
    // describedby it is never read out to anyone who cannot see it.
    const emailSelect = controlFor<HTMLSelectElement>("Email for this organization");
    const describedBy = emailSelect.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      "Used for your profile and actions in this organization capacity.",
    );

    // The visibility switch takes its name from the label that wraps it.
    const visibility = container.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(visibility.closest("label")?.textContent).toContain("public page");
  });

  it("offers no organization-scoped field to an individual member", async () => {
    profile.value = myProfileSchema.parse({
      ...currentProfile(),
      organizationId: null,
      organizationName: null,
      jobTitle: null,
      emailId: null,
    });
    renderPanel();
    await settle();

    // A job title and an organization email belong to an organization-tied
    // identity; the route rejects them from anybody else, so they are not
    // offered.
    expect(container.textContent).not.toContain("Job title for this organization");
    expect(container.textContent).not.toContain("Email for this organization");
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("reports a failed save in an alert and leaves the stored profile untouched", async () => {
    const initial = currentProfile();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : String(input), location.origin);
        const method = init?.method ?? "GET";
        if (method === "PATCH" && url.pathname === "/api/v1/users/current") return new Response(null, { status: 500 });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );
    profile.value = initial;
    renderPanel();
    await settle();

    const submit = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save changes",
    )!;
    const form = submit.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // A transport status never reaches the reader; the failure is announced,
    // not merely coloured, and the form stays usable for a second attempt.
    const alert = await waitForElement(() => form.querySelector('[role="alert"]'));
    expect(alert.textContent).toContain("Something went wrong on our side");
    expect(alert.textContent).not.toContain("HTTP 500");
    expect(profile.value).toBe(initial);

    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save changes",
    )!;
    expect(retry.disabled).toBe(false);
    expect(retry.getAttribute("aria-busy")).toBeNull();
  });
});
