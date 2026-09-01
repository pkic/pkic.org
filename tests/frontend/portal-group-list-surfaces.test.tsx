// @vitest-environment jsdom
/**
 * The read-only list surfaces of the group and application workspaces: the
 * participant roster, the meeting series list, the proposal-program catalog,
 * the application document list, and the event form picker.
 *
 * These had no tests at all. What is asserted is the part a visual review
 * cannot see — that each table names itself, that a row's controls say which
 * row they belong to, that a status is a word and not only a colour, and that
 * a refused load replaces the list rather than letting an empty state claim
 * something the surface does not know.
 */
import { render, type ComponentChild, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationDocumentsCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationDocumentsCard";
import { EventFormLinkSelect } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EventFormLinkSelect";
import { GroupForms } from "../../assets/ts/member-flows/portal/sections/management/GroupForms";
import { GroupMeetingSeriesList } from "../../assets/ts/member-flows/portal/sections/management/GroupMeetingSeriesList";
import { GroupMembersRoster } from "../../assets/ts/member-flows/portal/sections/management/GroupMembersRoster";
import { GroupVotes } from "../../assets/ts/member-flows/portal/sections/management/GroupVotes";
import { ProposalPrograms } from "../../assets/ts/member-flows/portal/sections/management/ProposalPrograms";
import { controlFor } from "./helpers/labelled-control";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const SERIES_ID = "50000000-0000-4000-8000-000000000001";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "70000000-0000-4000-8000-000000000001";
const NOW = "2026-12-01T09:00:00.000Z";
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChild): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("the participant roster", () => {
  function rosterResponse(memberships: unknown[]) {
    return { memberships, page: { limit: 25, offset: 0, total: memberships.length, hasMore: false } };
  }

  it("names the panel and gives the search a label a reader can see", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          rosterResponse([
            { userId: USER_ID, name: "Ada Lovelace", organizationName: "Example Corp", headshotUrl: null },
          ]),
        ),
      ),
    );
    const page = mount(<GroupMembersRoster groupId={GROUP_ID} />);
    await settle();

    expect(page.querySelector("section")?.getAttribute("aria-label")).toBe("Members");

    // The name used to be visually hidden, which is a name a sighted reader
    // cannot use either. It is reached through the `for`/`id` pair now.
    const search = controlFor(page, "Search members");
    expect(search.type).toBe("search");
    const describedBy = search.getAttribute("aria-describedby");
    expect(page.querySelector(`[id="${describedBy!}"]`)?.textContent).toContain("organization they represent");

    // The roster is announced as a list without the bullet a `<ul>` would put
    // beside every face.
    expect(page.querySelector('[role="list"]')).toBeTruthy();
    expect(page.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    expect(page.textContent).toContain("Ada Lovelace");
  });

  it("replaces the roster with the failure rather than claiming nobody matched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Not a participant here." } }, 403)),
    );
    const page = mount(<GroupMembersRoster groupId={GROUP_ID} />);
    await settle();

    expect(page.textContent).not.toContain("No matching members.");
    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Not a participant here.");
  });

  it("says the search matched nothing, as a status, when the group answers with no rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(rosterResponse([]))),
    );
    const page = mount(<GroupMembersRoster groupId={GROUP_ID} />);
    await settle();

    expect(page.querySelector('[role="status"]')?.textContent).toContain("No matching members.");
  });
});

describe("the meeting series list", () => {
  function series(overrides: Record<string, unknown> = {}) {
    return {
      id: SERIES_ID,
      eventId: EVENT_ID,
      ownerGroupId: GROUP_ID,
      eventName: "Monthly sync",
      eventSlug: "monthly-sync",
      profileKey: "meeting",
      registrationPolicy: "optional",
      visibility: "group_members",
      startsAt: NOW,
      recurrenceRule: "FREQ=MONTHLY",
      timezone: "UTC",
      durationMinutes: 60,
      location: "Room 1",
      providerType: null,
      providerConfigured: false,
      active: true,
      inviteWindow: { startsAt: null, endsAt: null, timezone: "UTC" },
      nextOccurrenceAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      capabilities: ["view"],
      occurrenceCount: 3,
      ...overrides,
    };
  }

  function listResponse(rows: unknown[]) {
    return { series: rows, page: { limit: 50, offset: 0, total: rows.length, hasMore: false } };
  }

  it("names each row's calendar and details control after the series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listResponse([series()]))),
    );
    const page = mount(<GroupMeetingSeriesList groupId={GROUP_ID} />);
    await settle();

    expect(page.querySelector("caption")?.textContent).toBe("Meeting series");
    expect(page.querySelector('a[aria-label="Calendar for Monthly sync"]')).toBeTruthy();

    const details = page.querySelector<HTMLButtonElement>('button[aria-label="Details for Monthly sync"]')!;
    expect(details.getAttribute("aria-expanded")).toBe("false");
  });

  it("states an active series in words rather than as a grey dash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          listResponse([
            series(),
            series({ id: "50000000-0000-4000-8000-000000000002", eventName: "Retired sync", active: false }),
          ]),
        ),
      ),
    );
    const page = mount(<GroupMeetingSeriesList groupId={GROUP_ID} />);
    await settle();

    const badges = [...page.querySelectorAll(".pk-badge")].map((badge) => badge.textContent);
    expect(badges).toContain("Active");
    expect(badges).toContain("Inactive");
  });

  it("shows the load failure instead of an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "SERVER_ERROR", message: "Meetings are unavailable." } }, 500)),
    );
    const page = mount(<GroupMeetingSeriesList groupId={GROUP_ID} />);
    await settle();

    expect(page.querySelector("table")).toBeNull();
    expect(page.querySelector('[role="alert"]')).toBeTruthy();
  });
});

describe("the proposal program catalog", () => {
  function program() {
    return {
      group: { id: GROUP_ID, slug: "pqc-task-force", name: "PQC task force" },
      event: { id: EVENT_ID, slug: "autumn-workshop", name: "Autumn workshop", startsAt: NOW },
      access: {
        eventPermissions: ["proposals:read", "proposals:review"],
        canRead: true,
        canReview: true,
        canFinalize: false,
        canEditAcceptedAbstract: false,
        canCancelAcceptedProposal: false,
      },
    };
  }

  it("names the panel, the table and the whole-row link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ programs: [program()], page: { limit: 50, offset: 0, total: 1, hasMore: false } })),
    );
    const page = mount(<ProposalPrograms />);
    await settle();

    expect(page.querySelector("section")?.getAttribute("aria-label")).toBe("Proposal programs");
    expect(page.querySelector("caption")?.textContent).toBe("Proposal programs");

    // The row activates through a real link, reachable by Tab and openable in
    // a new tab — not an onClick on the `<tr>`.
    const rowLink = page.querySelector<HTMLAnchorElement>("tbody a")!;
    expect(rowLink.textContent).toBe("Open proposals for Autumn workshop");
    expect(rowLink.getAttribute("href")).toContain(`/events/${EVENT_ID}/proposals`);

    // The capability is a word, not a tone.
    expect(page.textContent).toContain("Review proposals");
  });

  it("explains an empty catalog as a status rather than a bare line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ programs: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const page = mount(<ProposalPrograms />);
    await settle();

    expect(page.querySelector('[role="status"]')?.textContent).toContain(
      "No proposal programs are available to your current identity.",
    );
  });
});

describe("the application document list", () => {
  it("names itself among the cards on the detail page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          documents: [
            {
              id: DOCUMENT_ID,
              filename: "charter.pdf",
              mimeType: "application/pdf",
              fileSizeBytes: 2048,
              uploadedByEmail: "ada@example.test",
              uploadedAt: NOW,
            },
          ],
          page: { limit: 10, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const page = mount(<ApplicationDocumentsCard applicationId="app-1" />);
    await settle();

    expect(page.querySelector("section")?.getAttribute("aria-label")).toBe("Documents");
    expect(page.querySelector("h3")?.textContent).toBe("Documents");
    expect(page.querySelector("caption")?.textContent).toBe("Application documents");
    expect(page.textContent).toContain("charter.pdf");
  });

  it("shows a refused document listing instead of claiming there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Documents are restricted." } }, 403)),
    );
    const page = mount(<ApplicationDocumentsCard applicationId="app-1" />);
    await settle();

    expect(page.textContent).not.toContain("No documents uploaded");
    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Documents are restricted.");
  });
});

describe("the event form picker", () => {
  it("describes the picker with the sentence explaining it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ forms: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })),
    );
    const page = mount(
      <EventFormLinkSelect
        eventSlug="autumn-workshop"
        purpose="event_registration"
        label="Registration form"
        value=""
        disabled={false}
        help="Choose the form this event should use for registrations."
        onChange={vi.fn()}
      />,
    );
    await settle();

    // A bare `<div>` cannot carry a name, so the pair is a named group and the
    // sentence is its description rather than text floating below a control.
    const group = page.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Registration form");
    const describedBy = group.getAttribute("aria-describedby");
    expect(page.querySelector(`[id="${describedBy!}"]`)?.textContent).toBe(
      "Choose the form this event should use for registrations.",
    );

    // The select inside it is still reached through its own label.
    expect(controlFor<HTMLSelectElement>(page, "Registration form").tagName.toLowerCase()).toBe("select");
  });

  it("surfaces a catalog that could not be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "SERVER_ERROR", message: "Form catalog unavailable." } }, 500)),
    );
    const page = mount(
      <EventFormLinkSelect
        eventSlug="autumn-workshop"
        purpose="proposal_submission"
        label="Proposal form"
        value=""
        disabled={false}
        help="Choose the form this event should use for proposals."
        onChange={vi.fn()}
      />,
    );
    await settle();

    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Form catalog unavailable.");
  });
});

describe("the group forms and votes collections", () => {
  it("gives the group forms panel a name and every row control the form it opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          forms: [
            {
              form: {
                id: "80000000-0000-4000-8000-000000000001",
                key: "architecture-survey",
                purpose: "survey",
                status: "active",
                title: "Architecture survey",
                description: "Collect group priorities.",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
              placement: {
                id: "80000000-0000-4000-8000-000000000002",
                formId: "80000000-0000-4000-8000-000000000001",
                ownerGroupId: GROUP_ID,
                contextType: "group",
                contextRef: GROUP_ID,
                audience: "group_members",
                active: true,
                opensAt: null,
                closesAt: null,
                createdAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
              capabilities: ["view_definition", "submit"],
              acceptingResponses: true,
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const container = mount(<GroupForms groupId={GROUP_ID} canManage />);
    await settle();

    expect(container.querySelector('section[aria-label="Group forms"]')).toBeTruthy();
    expect(container.querySelector("caption")?.textContent).toBe("Group forms");

    // A page of rows otherwise offers a column of buttons all called
    // "Details".
    const details = container.querySelector<HTMLButtonElement>('button[aria-label="Details for Architecture survey"]')!;
    expect(details.getAttribute("aria-expanded")).toBe("false");
  });

  it("switches the votes sections as a tab set, with the panel pointing back at its tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ votes: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const container = mount(<GroupVotes groupId={GROUP_ID} canManage canParticipate />);
    await settle();

    // The strip used to be a `<ul>` of buttons wearing `nav-link`, which
    // announced a list and said nothing about which of the two was showing.
    const strip = container.querySelector('[role="tablist"]')!;
    expect(strip.getAttribute("aria-label")).toBe("Vote sections");

    const [allVotes, proposals] = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(allVotes.getAttribute("aria-selected")).toBe("true");
    expect(proposals.getAttribute("aria-selected")).toBe("false");

    // Exactly one tab is in the tab order; the arrows move within the set.
    expect(allVotes.tabIndex).toBe(0);
    expect(proposals.tabIndex).toBe(-1);

    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe(allVotes.id);
    expect(allVotes.getAttribute("aria-controls")).toBe(panel.id);

    await act(() => proposals.click());
    await settle();
    expect(container.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(proposals.id);
  });

  it("replaces the votes table with the failure rather than claiming there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Votes are not visible to you." } }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const container = mount(<GroupVotes groupId={GROUP_ID} canManage={false} canParticipate />);
    await settle();

    expect(container.textContent).not.toContain("No votes are available through this group.");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Votes are not visible to you.");
  });
});
