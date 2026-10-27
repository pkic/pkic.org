// @vitest-environment jsdom
/** Organization representatives use named columns and accessible row actions. */
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
import { portalSessionFixture } from "../helpers/portal-session";
import { rowActionControlNames } from "./helpers/row-actions";

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
    expect(headers).toEqual(["Name", "Status", "On profile", "Actions"]);
    for (const header of headers) expect(header).not.toBe("");
  });

  it("says each state in words and offers commands for active and ended identities", async () => {
    const [template] = identitiesPage().identities;
    const states = ["active", "pending", "ended"] as const;
    const people = ["Active Person", "Pending Person", "Ended Person"];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              identitiesListResponseSchema.parse({
                identities: states.map((state, index) => ({
                  ...template,
                  id: `00000000-0000-4000-8000-00000000002${index + 1}`,
                  userId: `00000000-0000-4000-8000-00000000001${index + 1}`,
                  userName: people[index],
                  email: `person-${index}@example.test`,
                  state,
                })),
                page: { limit: 25, offset: 0, total: 3, hasMore: false },
              }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const root = await mount(true);

    const rows = [...root.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.querySelectorAll("td")[1]?.querySelector(".pk-table__value")?.textContent)).toEqual([
      "Active",
      "Invitation pending",
      "Ended",
    ]);
    // Pending invitations can be cancelled; ended identities can be reinstated.
    expect(rowActionControlNames(root)).toEqual([
      "Actions for Active Person",
      "Actions for Pending Person",
      "Actions for Ended Person",
    ]);
  });

  it("uses the shared person row with title and initials without repeating the email", async () => {
    const root = await mount(true);

    const person = root.querySelector(".pk-person-cell");
    expect(person?.textContent).toContain("Ada Lovelace");
    expect(person?.textContent).toContain("Chief Engineer");
    expect(person?.textContent).not.toContain("ada@example.test");
    expect(person?.querySelector(".pk-avatar__initials")?.textContent).toBe("AL");
    for (const element of root.querySelectorAll<HTMLElement>("tbody div, tbody span")) {
      for (const name of element.classList) {
        expect(name.startsWith("pk-") || name.startsWith("portal-")).toBe(true);
      }
    }
  });

  it("makes the name a native profile link when the viewer can read user accounts", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    const root = await mount(true);
    const name = root.querySelector<HTMLAnchorElement>("a.pk-person-cell-preview");
    expect(name?.getAttribute("href")).toBe(`#/users/${USER_ID}`);
    expect(name?.getAttribute("aria-expanded")).toBeNull();
    expect(name?.textContent).toContain(ACTIVE.name);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    name?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("keeps the person-card toggle when the viewer has no profile destination", async () => {
    const root = await mount(false);
    const toggle = root.querySelector<HTMLButtonElement>("button.pk-person-cell-preview");
    expect(toggle?.type).toBe("button");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("a.pk-person-cell-preview")).toBeNull();
  });

  it("shows the read-only projection without a second request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(root.querySelector("caption")?.textContent).toBe("Organization identities");
    expect(root.textContent).toContain("Ada Lovelace");
    expect([...root.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Name"]);
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
