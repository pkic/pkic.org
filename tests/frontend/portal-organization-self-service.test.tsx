// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { organizationContentReviewCreateSchema } from "../../assets/shared/schemas/organization-self-service";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { MyOrganization } from "../../assets/ts/member-flows/portal/sections/MyOrganization";
import { profile } from "../../assets/ts/member-flows/portal/state";

const organizationId = "00000000-0000-4000-8000-000000000210";
const userId = "00000000-0000-4000-8000-000000000211";
const memberId = "00000000-0000-4000-8000-000000000212";
const identityId = "00000000-0000-4000-8000-000000000213";

let container: HTMLDivElement;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  profile.value = myProfileSchema.parse({
    userId,
    emailId: null,
    email: "contact@example.test",
    emailAddresses: [
      {
        id: null,
        email: "contact@example.test",
        primary: true,
        verifiedAt: null,
        verificationMethod: null,
      },
    ],
    firstName: "Contact",
    lastName: "Person",
    preferredName: null,
    jobTitle: null,
    biography: null,
    links: [],
    membershipCategory: "F",
    organizationId,
    organizationName: "Example Organization",
    memberSince: "2026-01-01",
    showOnOrgProfile: true,
    headshotUrl: null,
    canEditOrganizationName: false,
    isOrgContact: true,
    organizationIdentities: [],
    activeIdentities: [
      { identityId, memberId, organizationId, organizationName: "Example Organization", membershipCategory: "F" },
    ],
  });
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("portal organization self-service", () => {
  it("loads only explicit organization resource paths", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url.pathname);
        if (url.pathname === `/api/v1/organizations/${organizationId}/profile`) {
          return json({
            organization: {
              id: organizationId,
              name: "Example Organization",
              website: "https://example.test",
              description: "Example profile",
              slogan: null,
              logoUrl: null,
              contentMarkdown: null,
              blogUrl: null,
              blogFeedUrl: null,
              pressUrl: null,
              pressFeedUrl: null,
              careersUrl: null,
              links: [],
              isOrgContact: true,
              isPrimaryContact: true,
              pendingSecondaryContactUserId: null,
              pendingReview: null,
            },
          });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/content/reviews`) {
          return json({ reviews: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/sponsorships/current`) {
          return json({ sponsorship: { tier: null, startDate: null } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    void act(() => render(<MyOrganization />, container));
    await settle();

    expect(container.textContent).toContain("Example Organization");
    expect(requests).toEqual(
      expect.arrayContaining([
        `/api/v1/organizations/${organizationId}/profile`,
        `/api/v1/organizations/${organizationId}/content/reviews`,
        `/api/v1/organizations/${organizationId}/sponsors/current`,
      ]),
    );
    expect(requests.some((path) => path.startsWith("/api/v1/me"))).toBe(false);
  });

  function dialogButton(root: HTMLElement, label: string): HTMLButtonElement {
    const dialog = root.querySelector('[role="alertdialog"]');
    if (!dialog) throw new Error("no confirm dialog is open");
    const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    if (!button) throw new Error(`missing dialog button: ${label}`);
    return button;
  }

  function pendingReview() {
    return {
      id: "00000000-0000-4000-8000-000000000220",
      organizationId,
      submittedByUserId: userId,
      proposedChanges: { slogan: "New slogan" },
      hasLogoChange: false,
      status: "pending" as const,
      reviewerUserId: null,
      reviewerNote: null,
      submittedAt: "2026-08-20T00:00:00.000Z",
      reviewedAt: null,
    };
  }

  function organizationWithPendingReview() {
    return {
      id: organizationId,
      name: "Example Organization",
      website: "https://example.test",
      description: "Example profile",
      slogan: null,
      logoUrl: null,
      contentMarkdown: null,
      blogUrl: null,
      blogFeedUrl: null,
      pressUrl: null,
      pressFeedUrl: null,
      careersUrl: null,
      links: [],
      isOrgContact: true,
      isPrimaryContact: true,
      pendingSecondaryContactUserId: null,
      pendingReview: pendingReview(),
    };
  }

  it("withdraws the pending submission only after the named confirmation is accepted", async () => {
    const requests: { method: string; pathname: string }[] = [];
    let reloaded = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({ method: init?.method ?? "GET", pathname: url.pathname });
        if (url.pathname === `/api/v1/organizations/${organizationId}/profile`) {
          return json({
            organization: reloaded
              ? { ...organizationWithPendingReview(), pendingReview: null }
              : organizationWithPendingReview(),
          });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/content/reviews/${pendingReview().id}`) {
          reloaded = true;
          return json({ success: true });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/content/reviews`) {
          return json({ reviews: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/sponsors/current`) {
          return json({ sponsorship: { tier: null, startDate: null } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <MyOrganization />
        </>,
        container,
      ),
    );
    await settle();

    const withdrawButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Withdraw submission",
    );
    if (!withdrawButton) throw new Error("missing Withdraw submission button");
    void act(() => withdrawButton.click());

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Withdraw this pending submission?");
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);

    void act(() => dialogButton(container, "Withdraw submission").click());
    await settle();

    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  function organizationProfile(overrides: Record<string, unknown> = {}) {
    return { ...organizationWithPendingReview(), pendingReview: null, ...overrides };
  }

  /** The control a visible label is bound to, resolved the way a reader's
   *  assistive technology resolves it: through `for` and `id`, not proximity. */
  function labelledControl(root: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
    const element = [...root.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim() === label);
    if (!element) throw new Error(`no label reads "${label}"`);
    const control = document.getElementById(element.htmlFor);
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
      throw new Error(`the "${label}" label is not bound to a control`);
    }
    return control;
  }

  function stubOrganization(
    organization: Record<string, unknown>,
    onSubmission?: (body: unknown) => Response,
  ): { requests: string[] } {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
        if (url.pathname === `/api/v1/organizations/${organizationId}/profile`) {
          return json({ organization });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/content/reviews`) {
          if (init?.method === "POST" && onSubmission) return onSubmission(JSON.parse(String(init.body)));
          return json({ reviews: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/sponsors/current`) {
          return json({ sponsorship: { tier: null, startDate: null } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    return { requests };
  }

  it("reports a refused submission as a sentence and keeps what was typed", async () => {
    const submissions: unknown[] = [];
    stubOrganization(organizationProfile(), (body) => {
      submissions.push(body);
      // No JSON payload, so the client falls back to "HTTP 403" — precisely
      // the transport phrasing that must never reach the reader.
      return new Response("", { status: 403 });
    });

    void act(() => render(<MyOrganization />, container));
    await settle();

    const slogan = labelledControl(container, "Slogan");
    slogan.value = "Trust, made routine";
    await act(() => {
      slogan.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      slogan.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    // The request is checked against the canonical contract rather than
    // against a literal copy of what the component just sent.
    expect(organizationContentReviewCreateSchema.parse(submissions[0])).toEqual({ slogan: "Trust, made routine" });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(container.textContent).not.toContain("HTTP 403");
    // A failed submission is a retry, not a restart: the edit survives it.
    expect(labelledControl(container, "Slogan").value).toBe("Trust, made routine");
  });

  it("withholds the editor and the submission history from a member who is not an organization contact", async () => {
    const { requests } = stubOrganization(organizationProfile({ isOrgContact: false, isPrimaryContact: false }));

    void act(() => render(<MyOrganization />, container));
    await settle();

    expect(container.textContent).toContain("Example Organization");
    expect(container.textContent).toContain("Example profile");
    expect(container.textContent).not.toContain("Edit organization content");
    expect(container.textContent).not.toContain("Submission history");
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
      "Change logo (SVG)",
    );
    expect(container.querySelector("form")).toBeNull();
    // The review collection is a contact-only resource, so it is never fetched.
    expect(requests.some((request) => request.endsWith("/content/reviews"))).toBe(false);
  });

  it("names its form controls and its history table for assistive technology", async () => {
    stubOrganization(organizationProfile());

    void act(() => render(<MyOrganization />, container));
    await settle();

    // Every editable field is bound to its label, so a screen reader announces
    // the field rather than an unlabelled edit box.
    for (const label of ["Slogan", "Description", "Long-form content (Markdown)", "Website"]) {
      expect(labelledControl(container, label)).toBeInstanceOf(HTMLElement);
    }

    // The history table is named, so it is identifiable among the surface's
    // regions, and its wait is announced rather than mimed by grey rectangles.
    const table = container.querySelector("table");
    expect(table?.querySelector("caption")?.textContent).toBe("Organization content submissions");
    expect(table?.getAttribute("aria-busy")).toBe("true");

    // The history request is issued once the profile has resolved, so it
    // settles a tick later than the rest of the surface.
    await settle();
    expect(container.querySelector("table")?.getAttribute("aria-busy")).toBeNull();
    // The empty region announces itself instead of being an unexplained blank.
    expect(container.querySelector('[role="status"]')?.textContent).toContain("No past submissions.");
  });
});
