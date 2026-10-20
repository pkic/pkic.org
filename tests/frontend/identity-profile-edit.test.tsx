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
  links: [],
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
  await act(async () => {
    jobTitle.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();

  expect(sent).toEqual([expect.objectContaining({ jobTitle: "Chair" })]);
  expect(navigate).toHaveBeenCalledWith(`/users/${userId}/profile`);
});

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
