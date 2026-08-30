// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { MyOrganization } from "../../assets/ts/member-flows/portal/sections/MyOrganization";
import { profile } from "../../assets/ts/member-flows/portal/state";

const organizationId = "00000000-0000-4000-8000-000000000210";
const userId = "00000000-0000-4000-8000-000000000211";
const memberId = "00000000-0000-4000-8000-000000000212";

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
    organizationRepresentatives: [],
    activeMemberships: [
      { memberId, organizationId, organizationName: "Example Organization", membershipCategory: "F" },
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
});
