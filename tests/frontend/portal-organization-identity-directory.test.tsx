// @vitest-environment jsdom
/**
 * The organization identity directory.
 *
 * Two things the Bootstrap version left to colour alone: the contact role,
 * which was a blue pill and an "info" pill with nothing distinguishing them
 * to a reader who cannot see the hues, and the action column, whose `th` was
 * empty and so announced as an unnamed column.
 */
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import {
  ActingIdentityDirectory,
  type ActiveActingIdentity,
} from "../../assets/ts/member-flows/portal/sections/OrganizationIdentityDirectory";
import { portalSession } from "../../assets/ts/member-flows/portal/state";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000010";
const USER_ID = "00000000-0000-4000-8000-000000000011";
const IDENTITY_ID = "00000000-0000-4000-8000-000000000021";
const MEMBER_ID = "00000000-0000-4000-8000-000000000031";

let container: HTMLDivElement | null = null;
let toastArea: HTMLDivElement | null = null;

const ACTIVE: ActiveActingIdentity = {
  identityId: IDENTITY_ID,
  userId: USER_ID,
  name: "Ada Lovelace",
  email: "ada@example.test",
  headshotUrl: null,
  jobTitle: "Chief Engineer",
  showOnOrgProfile: true,
  isPrimaryContact: true,
  isSecondaryContact: true,
};

function identitiesPage() {
  const now = "2026-01-01T00:00:00.000Z";
  return identitiesListResponseSchema.parse({
    identities: [
      {
        id: IDENTITY_ID,
        memberId: MEMBER_ID,
        organizationId: ORGANIZATION_ID,
        organizationName: "Example Corp",
        membershipCategory: "full",
        userId: USER_ID,
        userName: "Ada Lovelace",
        emailId: null,
        email: "ada@example.test",
        jobTitle: "Chief Engineer",
        biography: null,
        links: [],
        headshotUrl: null,
        source: "membership_approval",
        state: "active",
        showOnOrganizationProfile: true,
        invitedAt: now,
        startedAt: now,
        endedAt: null,
        blockedAt: null,
        blockedByUserId: null,
        predecessorIdentityId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    page: { limit: 25, offset: 0, total: 1, hasMore: false },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(canManage: boolean): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(
      <ActingIdentityDirectory organizationId={ORGANIZATION_ID} activeIdentities={[ACTIVE]} canManage={canManage} />,
      container!,
    );
    await Promise.resolve();
  });
  await settle();
  return container;
}

beforeEach(() => {
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(toastArea);
  portalSession.value = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(identitiesPage()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  toastArea?.remove();
  toastArea = null;
  portalSession.value = null;
  vi.unstubAllGlobals();
});

describe("ActingIdentityDirectory", () => {
  it("names the table and every column, including the one holding the actions", async () => {
    const root = await mount(true);

    expect(root.querySelector("caption")?.textContent).toBe("Organization identities");
    const headers = [...root.querySelectorAll("thead th")].map((cell) =>
      (cell.textContent ?? "").replace(/[↑↓↕]/g, "").trim(),
    );
    expect(headers).toEqual(["Name", "Status", "Contact role", "On profile", "Actions"]);
    for (const header of headers) expect(header).not.toBe("");
  });

  it("says each contact role in words, not only as a tinted pill", async () => {
    const root = await mount(true);

    const badges = [...root.querySelectorAll(".pk-badge")].map((badge) => badge.textContent);
    expect(badges).toEqual(["Primary", "Secondary"]);
  });

  it("dresses the identity's email as code and its details on the space scale", async () => {
    const root = await mount(true);

    const email = [...root.querySelectorAll<HTMLElement>("div")].find(
      (element) => element.textContent === "ada@example.test",
    );
    expect(email?.className).toBe("pk-mono pk-small");
    for (const element of root.querySelectorAll<HTMLElement>("tbody div, tbody span")) {
      for (const name of element.classList) {
        expect(name.startsWith("pk-") || name.startsWith("portal-")).toBe(true);
      }
    }
  });

  it("shows the read-only projection without a second request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(root.querySelector("caption")?.textContent).toBe("Organization identities");
    expect(root.textContent).toContain("Ada Lovelace");
  });

  it("states the failure when the directory cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "forbidden", message: "HTTP 403" } }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const root = await mount(true);

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("You don't have access to this.");
  });
});
