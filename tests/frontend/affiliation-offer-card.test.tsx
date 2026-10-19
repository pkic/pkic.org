// @vitest-environment jsdom
/**
 * The organization question on Home and Account Settings: it offers the
 * organization a verified work address belongs to through the existing join,
 * and steers free-mail people to their organization's address with an
 * explicit independent escape.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  affiliationLinkKeptSchema,
  affiliationOfferDismissalSchema,
  affiliationOfferResponseSchema,
} from "../../assets/shared/schemas/affiliation-offer";
import { currentUserIdentityCreateSchema } from "../../assets/shared/schemas/identity";
import { JOB_TITLE_REQUIRED } from "../../assets/shared/schemas/identity-job-title";
import { AffiliationOfferCard } from "../../assets/ts/member-flows/portal/sections/AffiliationOfferCard";

const organizationId = "00000000-0000-4000-8000-000000000021";
const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Serves the offer and records every write, answering each with what its route returns. */
function stubOffer(offer: unknown) {
  const writes: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      if (!init?.method || init.method === "GET")
        return Promise.resolve(json(affiliationOfferResponseSchema.parse({ offer })));
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Promise.resolve(
        path.endsWith("/dismissals") || path.endsWith("/confirmations")
          ? json({ success: true }, 201)
          : json({ success: true, identityId: "00000000-0000-4000-8000-000000000022", state: "active" }, 201),
      );
    }),
  );
  return writes;
}

async function click(host: HTMLElement, label: string): Promise<void> {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

/** Types the job title an organization identity always carries. */
async function enterJobTitle(host: HTMLElement, value: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('input[name="jobTitle"]');
  expect(input?.required).toBe(true);
  await act(async () => {
    input!.value = value;
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("affiliation offer card", () => {
  it("offers the organization the work address belongs to and joins it through the existing join", async () => {
    const writes = stubOffer({
      kind: "organization",
      organization: { id: organizationId, name: "IBM" },
      emailId: null,
      domain: "ibm.nl",
      writtenOrganizationName: "IBM Netherlands",
    });
    const host = mount(<AffiliationOfferCard />);
    await settle();
    expect(host.textContent).toContain("You’ll be linked to IBM (from your @ibm.nl email).");
    expect(host.textContent).toContain("Your profile said “IBM Netherlands”.");

    // Joining creates an organization identity, which never goes without a job title.
    await click(host, "Join IBM");
    expect(writes).toEqual([]);
    expect(host.querySelector('input[name="jobTitle"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain(JOB_TITLE_REQUIRED);
    await enterJobTitle(host, "Security architect");
    await click(host, "Join IBM");
    expect(writes.map((write) => write.path)).toEqual(["/api/v1/users/current/identities"]);
    expect(currentUserIdentityCreateSchema.parse(writes[0]!.body)).toEqual({
      emailId: null,
      organizationId,
      jobTitle: "Security architect",
    });
    expect(host.textContent).toBe("");
  });

  it("records that an organization is not theirs", async () => {
    const writes = stubOffer({
      kind: "organization",
      organization: { id: organizationId, name: "IBM" },
      emailId: null,
      domain: "ibm.nl",
      writtenOrganizationName: null,
    });
    const host = mount(<AffiliationOfferCard />);
    await settle();
    await click(host, "Not my organization");
    expect(affiliationOfferDismissalSchema.parse(writes[0]!.body)).toEqual({ organizationId });
  });

  it("asks a free-mail person for their organization's address, or to say they are independent", async () => {
    const writes = stubOffer({ kind: "work_address", freeDomains: ["gmail.com"], writtenOrganizationName: null });
    const host = mount(<AffiliationOfferCard />);
    await settle();
    expect(host.textContent).toContain("Personal addresses such as @gmail.com never link you to an organization");
    const addAddress = Array.from(host.querySelectorAll("a")).find(
      (link) => link.textContent?.trim() === "Add your work address",
    );
    expect(addAddress?.getAttribute("href")).toBe("#/users/current/emails/new");
    await click(host, "I’m independent");
    expect(writes.map((write) => write.path)).toEqual(["/api/v1/users/current/identities/offer/dismissals"]);
    expect(affiliationOfferDismissalSchema.parse(writes[0]!.body)).toEqual({ organizationId: null });
  });

  it("tells a person about an automatic link once, and either keeps it or says it is not theirs", async () => {
    const linked = {
      kind: "linked",
      organization: { id: organizationId, name: "Open Co" },
      identityId: "00000000-0000-4000-8000-000000000023",
      domain: "open.example",
    };
    let writes = stubOffer(linked);
    let host = mount(<AffiliationOfferCard />);
    await settle();
    expect(host.textContent).toContain("You’re now linked to Open Co (from your @open.example email)");
    await enterJobTitle(host, "Engineer");
    await click(host, "That’s right");
    expect(writes.map((write) => write.path)).toEqual(["/api/v1/users/current/identities/offer/confirmations"]);
    expect(affiliationLinkKeptSchema.parse(writes[0]!.body)).toEqual({ organizationId, jobTitle: "Engineer" });
    expect(host.textContent).toBe("");

    writes = stubOffer(linked);
    host = mount(<AffiliationOfferCard />);
    await settle();
    await click(host, "Not my organization");
    expect(writes.map((write) => write.path)).toEqual(["/api/v1/users/current/identities/offer/dismissals"]);
    expect(affiliationOfferDismissalSchema.parse(writes[0]!.body)).toEqual({ organizationId });
  });

  it("shows nothing when there is nothing to ask", async () => {
    stubOffer(null);
    const host = mount(<AffiliationOfferCard />);
    await settle();
    expect(host.textContent).toBe("");
  });
});
