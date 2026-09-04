// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventGroupGrantSchemas,
  formGroupGrantSchemas,
  mailingListGroupGrantSchemas,
  voteGroupGrantSchemas,
} from "../../assets/shared/schemas/resource-grants";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { ResourceSharingEditor } from "../../assets/ts/member-flows/portal/sections/management/ResourceSharingEditor";
import { buttonNamed, chooseComboboxOption, chooseOption, controlFor } from "./helpers/labelled-control";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

const OWNER_GROUP_ID = "10000000-0000-4000-8000-000000000001";
const GRANTEE_GROUP_ID = "10000000-0000-4000-8000-000000000002";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(kind: "event" | "formPlacement" | "vote" | "mailingList"): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <ResourceSharingEditor
          kind={kind}
          groupId={OWNER_GROUP_ID}
          resourceId={kind === "event" ? "architecture-workshop" : "80000000-0000-4000-8000-000000000001"}
          ownerGroupId={OWNER_GROUP_ID}
        />
      </>,
      container,
    ),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function confirmDialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing confirm dialog button: ${label}`);
  return button;
}

const granteeGroup = {
  id: GRANTEE_GROUP_ID,
  slug: "working-group",
  name: "Working Group",
  type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
};

const managedGroup = {
  ...granteeGroup,
  parentGroup: null,
  description: null,
  links: [],
  visibility: "authenticated",
  governanceInheritanceMode: "inherited",
  eligibilityMode: "managed",
  automaticEnrollmentMode: "none",
  allowAutomaticOptOut: false,
  publicLeadership: false,
  publicRoster: false,
  minEndorsersForBallot: 0,
  active: true,
  revision: 1,
  membershipCapacityCount: 1,
  participantCount: 1,
  childCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal resource sharing editor", () => {
  it.each([
    ["event", "events", "attend", eventGroupGrantSchemas.createSchema],
    ["formPlacement", "forms", "view_responses", formGroupGrantSchemas.createSchema],
    ["vote", "votes", "participate", voteGroupGrantSchemas.createSchema],
    ["mailingList", "mailing-lists", "post", mailingListGroupGrantSchemas.createSchema],
  ] as const)("uses the canonical %s grant contract", async (kind, resourcePath, selectedCapability, createSchema) => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    let grantActive = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body });
        if (url.pathname === "/api/v1/groups") {
          return json({ groups: [managedGroup], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
        }
        if (method === "POST") {
          grantActive = true;
          return json({
            success: true,
            created: true,
            grant: {
              granteeGroup,
              capability: selectedCapability,
              createdByUserId: null,
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          });
        }
        if (method === "DELETE") {
          grantActive = false;
          return json({ success: true });
        }
        return json({
          grants: grantActive
            ? [
                {
                  granteeGroup,
                  capability: selectedCapability,
                  createdByUserId: null,
                  createdAt: "2026-08-01T00:00:00.000Z",
                },
              ]
            : [],
          page: { limit: 50, offset: 0, total: grantActive ? 1 : 0, hasMore: false },
        });
      }),
    );

    const container = mount(kind);
    await settle();
    await settle();

    // The picker is intentionally server-backed and asks only for the
    // management projection; it never downloads the public group catalog.
    expect(requests.find(({ url }) => url.pathname === "/api/v1/groups")?.url.searchParams.get("manageable")).toBe(
      "true",
    );

    // Both controls are resolved through the `for`/`id` pair that names
    // them, so the lookup fails exactly when the labelling is broken.
    const capabilitySelect = controlFor<HTMLSelectElement>(container, "Capability");
    expect([...capabilitySelect.options].map((option) => option.value)).toContain(selectedCapability);
    await chooseComboboxOption(container, "Group", GRANTEE_GROUP_ID);
    await chooseOption(capabilitySelect, selectedCapability);
    await act(async () => buttonNamed(container, "Share").click());
    await settle();
    await settle();

    const grantPath = `/api/v1/groups/${OWNER_GROUP_ID}/${resourcePath}/${
      kind === "event" ? "architecture-workshop" : "80000000-0000-4000-8000-000000000001"
    }/grants`;
    const posted = requests.find(({ method }) => method === "POST");
    expect(posted?.url.pathname).toBe(grantPath);
    // The body is checked against the shared create contract rather than a
    // literal, so a field this surface stops sending fails here.
    expect(createSchema.parse(posted?.body)).toEqual({
      granteeGroupId: GRANTEE_GROUP_ID,
      capability: selectedCapability,
    });
    expect(container.textContent).toContain("Working Group");

    // The grants table announces itself by name rather than as one of several
    // unnamed tables on the page.
    expect(container.querySelector("caption")?.textContent).toContain("shared with");

    // Each shared group's control names that group, so a table of "Revoke"
    // buttons still says what each one revokes.
    expect(rowActionControlNames(container)).toEqual(["Actions for Working Group"]);
    await runRowAction(container, "Working Group", "Revoke");
    await act(async () => confirmDialogButton("Revoke access").click());
    await settle();
    expect(requests.find(({ method }) => method === "DELETE")).toMatchObject({
      url: expect.objectContaining({ pathname: `${grantPath}/${GRANTEE_GROUP_ID}/${selectedCapability}` }),
    });
  });

  it("states a rejected grant in an alert, claims nothing was saved, and stays retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/groups") {
          return json({ groups: [managedGroup], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
        }
        if ((init.method ?? "GET") === "POST") {
          return new Response(
            JSON.stringify({ error: { code: "CONFLICT", message: "That group already holds this capability." } }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        return json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const container = mount("event");
    await settle();
    await settle();

    await chooseComboboxOption(container, "Group", GRANTEE_GROUP_ID);
    await act(async () => buttonNamed(container, "Share").click());
    await settle();

    // The failure interrupts rather than sitting silently beside the form.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That group already holds this capability.");
    // A rejected request must never leave the success line standing.
    expect(container.textContent).not.toContain("Sharing grant saved.");
    // The submit button is live again, so the reader can correct and retry.
    const share = buttonNamed(container, "Share");
    expect(share.disabled).toBe(false);
    expect(share.getAttribute("aria-busy")).toBeNull();
  });
});
