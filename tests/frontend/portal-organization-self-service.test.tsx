// @vitest-environment jsdom
import {
  organizationId,
  userId,
  memberId,
  identityId,
  pendingReview,
  organizationWithPendingReview,
  organizationProfile,
} from "./helpers/organization-self-service";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema, myActingIdentitySchema } from "../../assets/shared/schemas/me";
import { organizationContentReviewCreateSchema } from "../../assets/shared/schemas/organization-self-service";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { MyOrganization } from "../../assets/ts/member-flows/portal/sections/MyOrganization";
import { profile } from "../../assets/ts/member-flows/portal/state";
import { beginRecordEdit } from "./helpers/record-edit";
import { controlFor, markdownControl } from "./helpers/labeled-control";

// The page carries the representatives roster, whose "Add coworker" leads to
// an address of its own; the location hook needs a router in this environment.
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations/example", vi.fn()] }));

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
    identityId,
    emailId: null,
    email: "contact@example.test",
    emailAddresses: [
      {
        id: null,
        email: "contact@example.test",
        primary: true,
        verifiedAt: null,
        verificationMethod: null,
        identityId: null,
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
  it.each([undefined, "new"])(
    "loads the organization record or dedicated add view (%s)",
    async (representativeSegment) => {
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
                isSecondaryContact: false,
                primaryContact: null,
                secondaryContact: null,
                pendingSecondaryContact: null,
                pendingSecondaryContactUserId: null,
                pendingReview: null,
              },
            });
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

      void act(() => render(<MyOrganization representativeSegment={representativeSegment} />, container));
      await settle();

      expect(container.textContent).toContain("Example Organization");
      if (representativeSegment) {
        expect(requests).toEqual([`/api/v1/organizations/${organizationId}/profile`]);
        expect(container.querySelector(".pk-profile-header")?.textContent).toContain("Example Organization");
        expect(container.querySelector("form")).not.toBeNull();
        expect(container.querySelector('[aria-label="Breadcrumb"]')?.textContent).toContain("Add a coworker");
        return;
      }
      expect(requests).toEqual(
        expect.arrayContaining([
          `/api/v1/organizations/${organizationId}/profile`,
          `/api/v1/organizations/${organizationId}/content/reviews`,
          `/api/v1/organizations/${organizationId}/sponsors/current`,
        ]),
      );
      expect(requests.some((path) => path.startsWith("/api/v1/me"))).toBe(false);
    },
  );

  function dialogButton(root: HTMLElement, label: string): HTMLButtonElement {
    const dialog = root.querySelector('[role="alertdialog"]');
    if (!dialog) throw new Error("no confirm dialog is open");
    const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    if (!button) throw new Error(`missing dialog button: ${label}`);
    return button;
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

  /** The control a visible label is bound to, resolved the way a reader's
   *  assistive technology resolves it: through `for` and `id`, not proximity. */
  function labeledControl(root: HTMLElement, label: string): HTMLElement {
    const element = [...root.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim() === label);
    if (!element) throw new Error(`no label reads "${label}"`);
    const control = document.getElementById(element.htmlFor);
    // A native control, or the Markdown editor's editing surface (#114).
    if (
      !(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) &&
      control?.getAttribute("role") !== "textbox"
    ) {
      throw new Error(`the "${label}" label is not bound to a control`);
    }
    return control;
  }

  function stubOrganization(
    organization: Record<string, unknown>,
    onSubmission?: (body: unknown) => Response,
    reviews: unknown[] = [],
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
          return json({ reviews, page: { limit: 25, offset: 0, total: reviews.length, hasMore: false } });
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

    await beginRecordEdit(container, "Member page content actions");
    await settle();
    const slogan = labeledControl(container, "Slogan") as HTMLInputElement;
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
    expect((labeledControl(container, "Slogan") as HTMLInputElement).value).toBe("Trust, made routine");
  });

  it("gives a contact the logo tile itself, SVG only, proposing a logo without removing the public one", async () => {
    stubOrganization(organizationProfile({ logoUrl: "https://example.test/logo.svg" }));

    void act(() => render(<MyOrganization />, container));
    await settle();

    const tile = container.querySelector<HTMLButtonElement>('button[aria-label="Change logo of Example Organization"]');
    expect(tile).not.toBeNull();
    expect(container.querySelector(`#${tile!.getAttribute("aria-describedby")!}`)?.textContent).toContain("SVG only.");
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe("image/svg+xml");
    // A representative's logo enters review; taking the public one down is not theirs to do here.
    expect(container.querySelector('button[aria-label^="Remove logo"]')).toBeNull();
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
      "Change logo (SVG)",
    );
  });

  it("withholds the editor and the submission history from a member who is not an organization contact", async () => {
    const { requests } = stubOrganization(organizationProfile({ isOrgContact: false, isPrimaryContact: false }));

    void act(() => render(<MyOrganization />, container));
    await settle();

    expect(container.textContent).toContain("Example Organization");
    expect(container.textContent).toContain("Example profile");
    expect(container.textContent).not.toContain("Edit organization content");
    expect(container.textContent).not.toContain("Profile change history");
    // The logo is shown read-only: the tile is not a control for a non-contact.
    expect(container.querySelector('button[aria-label*="logo of Example Organization"]')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    // The review collection is a contact-only resource, so it is never fetched.
    expect(requests.some((request) => request.endsWith("/content/reviews"))).toBe(false);
  });

  it("names its form controls and its history table for assistive technology", async () => {
    stubOrganization(organizationProfile());

    void act(() => render(<MyOrganization />, container));
    await settle();

    await beginRecordEdit(container, "Member page content actions");
    await settle();
    // Every editable field is bound to its label, so a screen reader announces
    // the field rather than an unlabeled edit box. The description is the
    // shared Markdown editor, a lazy chunk, so it is waited for.
    await markdownControl(container, "Description");
    for (const label of ["Slogan", "Description", "Website"]) {
      expect(labeledControl(container, label)).toBeInstanceOf(HTMLElement);
    }

    // The visual editor is a lazy module; wait for its accessible editing surface.
    await vi.waitFor(() => {
      const visualContent = container.querySelector('[role="textbox"][aria-label="Long-form content (Markdown)"]');
      expect(visualContent?.getAttribute("contenteditable")).toBe("true");
    });
    expect(container.querySelector('input[name="contentMarkdown"]')).not.toBeNull();

    // The history table is named, so it is identifiable among the surface's
    // regions, and its wait is announced rather than mimed by grey rectangles.
    const table = container.querySelector("table");
    expect(table?.querySelector("caption")?.textContent).toBe("Changes submitted to the organization profile");
    expect(table?.getAttribute("aria-busy")).toBeNull();

    // The history request is issued once the profile has resolved, so it
    // settles a tick later than the rest of the surface.
    await settle();
    expect(container.querySelector("table")?.getAttribute("aria-busy")).toBeNull();
    // The empty region announces itself instead of being an unexplained blank.
    expect(container.querySelector('[role="status"]')?.textContent).toContain("No profile changes submitted yet");
  });

  it("names what each past submission changed and shows the values it sent", async () => {
    stubOrganization(organizationProfile(), undefined, [
      {
        id: "30000000-0000-4000-8000-000000000001",
        organizationId,
        submittedByUserId: "30000000-0000-4000-8000-000000000002",
        proposedChanges: { slogan: "Trust, verified", website: "https://example.test/" },
        hasLogoChange: true,
        status: "approved",
        reviewerUserId: null,
        reviewerNote: null,
        submittedAt: "2026-09-29T19:04:00.000Z",
        reviewedAt: "2026-09-30T08:00:00.000Z",
      },
    ]);

    void act(() => render(<MyOrganization />, container));
    await settle();
    await settle();

    const table = container.querySelector("table")!;
    expect(table.textContent).toContain("Slogan, Website, Logo");
    expect(table.textContent).not.toContain("Trust, verified");
    const show = [...table.querySelectorAll("button")].find((button) => button.textContent === "Show changes")!;
    expect(show.getAttribute("aria-expanded")).toBe("false");
    await act(async () => show.click());
    expect(show.getAttribute("aria-expanded")).toBe("true");
    const detail = document.getElementById(show.getAttribute("aria-controls")!);
    expect(detail?.textContent).toContain("Slogan: Trust, verified");
    expect(detail?.textContent).toContain("Website: https://example.test/");
    expect(detail?.textContent).toContain("Logo: a new logo");
  });

  /** The governance and sponsorship cards, with the sponsorship answer chosen. */
  function stubGovernance(organization: Record<string, unknown>, sponsorship: Response | Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === `/api/v1/organizations/${organizationId}/profile`) return json({ organization });
        if (url.pathname === `/api/v1/organizations/${organizationId}/content/reviews`) {
          return json({ reviews: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/sponsors/current`) {
          return sponsorship instanceof Response ? sponsorship : json(sponsorship);
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
  }

  function withIdentities(): void {
    profile.value = {
      ...profile.value!,
      organizationIdentities: [
        {
          identityId,
          userId,
          name: "Contact Person",
          email: "contact@example.test",
          showOnOrgProfile: true,
          isPrimaryContact: true,
          isSecondaryContact: false,
        },
        {
          identityId: "00000000-0000-4000-8000-000000000214",
          userId: "00000000-0000-4000-8000-000000000215",
          name: "Second Person",
          email: "second@example.test",
          showOnOrgProfile: true,
          isPrimaryContact: false,
          isSecondaryContact: false,
        },
      ].map((identity) => myActingIdentitySchema.parse(identity)),
    };
  }

  it("binds the secondary-contact nomination to a label and its explanation", async () => {
    withIdentities();
    stubGovernance(organizationProfile(), { sponsorship: { tier: null, startDate: null } });

    void act(() => render(<MyOrganization />, container));
    await settle();

    // The selector used to carry no name at all — a heading above it is not a
    // label, so the control announced itself as an unnamed combo box.
    const select = controlFor<HTMLSelectElement>(container, "Nominee");
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((option) => option.textContent)).toEqual(["None", "Second Person"]);

    // The guidance is tied to the control rather than left as loose prose
    // beside it, so it is announced with the field.
    const described = container.querySelector(`#${select.getAttribute("aria-describedby")!}`);
    expect(described?.textContent).toContain("staff confirmation");
  });

  it("states the pending nomination in a sentence for a member who cannot change it", async () => {
    withIdentities();
    stubGovernance(
      organizationProfile({
        isPrimaryContact: false,
        pendingSecondaryContactUserId: "00000000-0000-4000-8000-000000000215",
      }),
      { sponsorship: { tier: null, startDate: null } },
    );

    void act(() => render(<MyOrganization />, container));
    await settle();

    expect(container.textContent).toContain("Pending staff confirmation:");
    expect(() => controlFor(container, "Nominee")).toThrow();
  });

  it("says the sponsorship tier in words rather than by a text transform", async () => {
    stubGovernance(organizationProfile(), { sponsorship: { tier: "gold", startDate: "2026-02-01" } });

    void act(() => render(<MyOrganization />, container));
    // The sponsorship is fetched by the card itself, one tick behind the
    // profile the surface waits on, so the wait resolves a settle later.
    await settle();
    await settle();

    // The capitalization is in the text, so the word reaches a screen reader
    // the same way it reaches the screen.
    expect(container.textContent).toContain("Active Gold sponsor since");
  });

  /**
   * A representative arrives at this record from the list of organizations
   * they represent, and the Organizations sidebar entry is a staff
   * destination they do not have — so without a trail the record was where
   * navigation stopped (issue #9). The staff twin of the same route has
   * always rendered one; this is the same trail, to the same list.
   */
  it("opens with the organization hero: the logo as its mark and the slogan as its lede", async () => {
    stubOrganization(organizationProfile({ slogan: "Trust, delivered", logoUrl: "https://example.test/logo.svg" }));

    void act(() => render(<MyOrganization />, container));
    await settle();

    const hero = container.querySelector(".pk-profile-header");
    expect(hero?.querySelector(".pk-profile-header__title")?.textContent).toBe("Example Organization");
    expect(hero?.querySelector('button[aria-label="Change logo of Example Organization"]')).not.toBeNull();
    expect(hero?.textContent).toContain("Trust, delivered");
    // Said once: the profile panel does not repeat the hero's slogan.
    expect(container.textContent?.split("Trust, delivered")).toHaveLength(2);
  });

  it("offers the way back to the organizations the reader represents", async () => {
    stubGovernance(organizationProfile(), { sponsorship: { tier: null, startDate: null } });

    void act(() => render(<MyOrganization />, container));
    await settle();

    const trail = container.querySelector('nav[aria-label="Breadcrumb"]');
    expect(trail).not.toBeNull();
    expect(trail!.querySelector("a")?.getAttribute("href")).toBe("#/organizations");
    expect(trail!.querySelector("a")?.textContent).toBe("Organizations");
    // The record itself is the trail's last step, and says so rather than
    // offering a link back to where the reader already is.
    expect(trail!.querySelector('[aria-current="page"]')?.textContent).toBe("Example Organization");
  });

  it("reports a refused sponsorship lookup as a sentence, not a status code", async () => {
    stubGovernance(organizationProfile(), new Response("", { status: 500 }));

    void act(() => render(<MyOrganization />, container));
    await settle();
    await settle();

    const alerts = [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
    expect(alerts.some((text) => text.includes("Something went wrong on our side"))).toBe(true);
    expect(container.textContent).not.toContain("HTTP 500");
  });
  it("discards an earlier organization's response after switching organizations", async () => {
    const nextId = "00000000-0000-4000-8000-000000000299";
    let finishFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      finishFirst = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), location.origin).pathname;
        if (path === `/api/v1/organizations/${organizationId}/profile`) return first;
        if (path === `/api/v1/organizations/${nextId}/profile`) {
          return json({
            organization: organizationProfile({
              id: nextId,
              name: "Second organization",
              isOrgContact: false,
              isPrimaryContact: false,
            }),
          });
        }
        if (path.endsWith("/sponsors/current")) return json({ sponsorship: { tier: null, startDate: null } });
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    void act(() => render(<MyOrganization organizationId={organizationId} />, container));
    await settle();
    void act(() => render(<MyOrganization organizationId={nextId} />, container));
    await settle();
    expect(container.textContent).toContain("Second organization");
    await act(async () => {
      finishFirst(json({ organization: organizationProfile() }));
    });
    await settle();
    expect(container.textContent).toContain("Second organization");
    expect(container.textContent).not.toContain("Example Organization");
    expect(container.querySelector("select")).toBeNull();
  });
});
