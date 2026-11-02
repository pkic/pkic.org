import { IdentityProfileForm } from "../../assets/ts/components/identities/IdentityProfileForm";
// @vitest-environment jsdom
/**
 * Editing one identity from the professional profile: the view loads that
 * identity, sends a draft the route's contract accepts to that identity's own
 * address, and returns to the profile.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  identityProfileUpdateSchema,
  ownIdentityProfileSchema,
} from "../../assets/shared/schemas/own-identity-profile";
import { IdentityProfileEditView } from "../../assets/ts/member-flows/portal/sections/system-users/IdentityProfileEditView";
import { RegistrationIdentityField } from "../../assets/ts/components/RegistrationIdentitySelect";
import { portalSessionFixture } from "../helpers/portal-session";
import { typeInto, buttonNamed, controlFor as dialogControlFor } from "./helpers/labeled-control";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/self/profile", navigate] }));

const userId = "00000000-0000-4000-8000-000000000051";
const identityId = "00000000-0000-4000-8000-000000000052";
const identity = ownIdentityProfileSchema.parse({
  identityId,
  organizationId: "00000000-0000-4000-8000-000000000053",
  organizationName: "Example Trust",
  jobTitle: "Advisor",
  biography: null,
  links: ["https://github.com/example", "https://orcid.org/0000"],
});

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  vi.unstubAllGlobals();
  navigate.mockReset();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function controlFor<T extends HTMLElement>(label: string): T {
  const match = Array.from(container.querySelectorAll("label")).find(
    (candidate) => (candidate.textContent ?? "").replace(/\*?\(required\)$/, "").trim() === label,
  );
  if (!match) throw new Error(`No field labeled "${label}" was rendered.`);
  return document.getElementById(match.htmlFor) as T;
}

it("saves the named identity through its own contract and returns to the profile", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), location.origin);
      expect(url.pathname).toBe(`/api/v1/users/current/identities/${identityId}/profile`);
      if (init?.method === "PATCH") {
        const body = identityProfileUpdateSchema.parse(JSON.parse(String(init.body)));
        sent.push(body);
        return Response.json({ ...identity, ...body });
      }
      return Response.json(identity);
    }),
  );
  await act(async () => {
    render(<IdentityProfileEditView userId={userId} identityId={identityId} />, container);
  });
  await settle();

  expect(container.querySelector("h2")?.textContent).toBe("Edit Example Trust");
  expect(container.textContent).toContain("Your bio at Example Trust");
  expect(container.textContent).toContain("It does not replace About you");
  const jobTitle = controlFor<HTMLInputElement>("Job title for this organization");
  expect(jobTitle.value).toBe("Advisor");
  jobTitle.value = "Chair";
  await act(async () => {
    jobTitle.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await typeInto(container.querySelector<HTMLInputElement>('input[type="url"]')!, "https://example.org/profile");
  await act(async () => {
    jobTitle.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();

  expect(sent).toEqual([
    expect.objectContaining({
      jobTitle: "Chair",
      links: [...identity.links, "https://example.org/profile"],
    }),
  ]);
  expect(navigate).toHaveBeenCalledWith(`/users/${userId}/profile`);
});

it.each(["not a link", "https://github.com/example"])(
  "refuses an invalid or duplicate pending profile link before saving: %s",
  async (pending) => {
    const fetch = vi.fn(async () => Response.json(identity));
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      render(<IdentityProfileEditView userId={userId} identityId={identityId} />, container);
    });
    await settle();
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
    await typeInto(input, pending);
    await act(async () => {
      input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('fieldset [role="alert"]')?.textContent).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  },
);

it("asks an organization identity saved without a job title for one before it saves", async () => {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ ...identity, jobTitle: "Chair" });
      }
      return Response.json({ ...identity, jobTitle: null });
    }),
  );
  await act(async () => {
    render(<IdentityProfileEditView userId={userId} identityId={identityId} />, container);
  });
  await settle();
  const jobTitle = controlFor<HTMLInputElement>("Job title for this organization");
  expect(jobTitle.required).toBe(true);
  await act(async () => {
    jobTitle.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(sent).toEqual([]);
  expect(jobTitle.getAttribute("aria-invalid")).toBe("true");
  expect(container.textContent).toContain("Enter your job title at this organization.");
});

it("refreshes the canonical representation summary even when its selection dialog is canceled", async () => {
  let saved = identity;
  const selected = {
    id: identityId,
    organizationId: identity.organizationId,
    organizationName: identity.organizationName,
    jobTitle: identity.jobTitle,
    membershipCategory: null,
    membershipLabel: null,
  };
  const writes: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), location.origin).pathname;
      if (path.endsWith(`/identities/${identityId}/profile`)) {
        if (init.method === "PATCH") {
          const body = identityProfileUpdateSchema.parse(JSON.parse(String(init.body)));
          writes.push(body);
          saved = ownIdentityProfileSchema.parse({ ...saved, ...body });
        }
        return Response.json(saved);
      }
      if (path === "/api/v1/auth/session")
        return Response.json({
          ...portalSessionFixture({}),
          actingIdentityId: identityId,
          actingIdentities: [{ ...selected, jobTitle: saved.jobTitle }],
        });
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  const outerSubmit = vi.fn((event: Event) => event.preventDefault());
  const onSelect = vi.fn();
  await act(() =>
    render(
      <form onSubmit={outerSubmit}>
        <RegistrationIdentityField preferred={selected} userId={userId} onSelect={onSelect} />
      </form>,
      container,
    ),
  );
  await act(() => buttonNamed(container, "Change representation").click());
  await settle();
  await act(() => buttonNamed(document.body, "Edit representation").click());
  await settle();
  const title = dialogControlFor(document.body, "Job title for this organization");
  await typeInto(title, "Coordinator");
  await act(() => buttonNamed(document.body, "Save changes").click());
  await settle();
  expect(writes).toEqual([expect.objectContaining({ jobTitle: "Coordinator" })]);
  expect(outerSubmit).not.toHaveBeenCalled();
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close change representation"]')!.click());
  await settle();
  expect(container.textContent).toContain("Example Trust · Coordinator");
  expect(container.querySelector<HTMLInputElement>('input[name="identityId"]')?.value).toBe(identityId);
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: identityId, jobTitle: "Coordinator" }));
});

it.each(["owner", "staff"] as const)(
  "omits a personal job title from the shared %s editor and saved contract",
  async (editor) => {
    const save = vi.fn(async (body) => identityProfileUpdateSchema.parse(body));
    await act(() =>
      render(
        <IdentityProfileForm
          identity={{
            organizationId: null,
            jobTitle: "Legacy personal text",
            biography: "About this person",
            links: [],
          }}
          editor={editor}
          save={save}
          cancel={null}
          onSaved={() => {}}
        />,
        container,
      ),
    );
    expect(container.querySelector('[name="jobTitle"]')).toBeNull();
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(identityProfileUpdateSchema.parse(save.mock.calls[0]![0]).jobTitle).toBeUndefined();
  },
);
