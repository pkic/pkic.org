// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupAuditLog } from "../../assets/ts/member-flows/portal/sections/management/GroupAuditLog";
import { GroupEvents } from "../../assets/ts/member-flows/portal/sections/management/GroupEvents";
import { GroupForms } from "../../assets/ts/member-flows/portal/sections/management/GroupForms";
import { GroupMailingLists } from "../../assets/ts/member-flows/portal/sections/management/GroupMailingLists";
import { GroupVotes } from "../../assets/ts/member-flows/portal/sections/management/GroupVotes";
import { groupMailingListCreateSchema } from "../../assets/shared/schemas/mailing-lists";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";
import { tabs } from "./helpers/tabs";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
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

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal selected-group collections", () => {
  it("shows the manager collection with server-side query parameters and no participant controls for staff-only managers", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return json({
          mailingLists: [
            {
              id: "a0000000-0000-4000-8000-000000000001",
              email: "architecture@lists.example.test",
              label: "Architecture discussion",
              purpose: "group",
              groupId: GROUP_ID,
              primaryDiscussion: true,
              subscriptionDefault: "group_members",
              postingPolicy: "members",
              moderationPolicy: "moderated",
              autoSyncCategories: null,
              active: true,
              archivedAt: null,
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} />);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await settle();

    expect(container.textContent).toContain("Managed mailing lists");
    expect(container.textContent).toContain("Architecture discussion");
    expect(container.textContent).not.toContain("My mailing-list preferences");
    expect(container.querySelector('select[aria-label^="Subscription preference"]')).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      pathname: `/api/v1/groups/${GROUP_ID}/mailing-lists/management`,
    });
    expect(requests[0].searchParams.get("limit")).toBe("50");
    expect(requests[0].searchParams.get("sort")).toBe("label");
  });

  it("renders the manager empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ mailingLists: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage />);
    await settle();
    expect(container.textContent).toContain("No mailing lists yet");
    expect(container.textContent).toContain("Add mailing list");
  });

  it("renders manager collection errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Not allowed" }), { status: 403 })),
    );
    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage />);
    await settle();
    expect(container.textContent).toContain("don't have access");
  });

  it("creates, edits, and archives a fully configured group list without moving ownership", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    const list = {
      id: "a0000000-0000-4000-8000-000000000001",
      email: "architecture@lists.example.test",
      label: "Architecture discussion",
      purpose: "group",
      groupId: GROUP_ID,
      primaryDiscussion: true,
      subscriptionDefault: "group_members",
      postingPolicy: "members",
      moderationPolicy: "moderated",
      autoSyncCategories: ["A"],
      active: true,
      archivedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    } as const;
    const page = { limit: 50, offset: 0, total: 1, hasMore: false };
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
        if (method === "POST") return json({ mailingList: list });
        if (method === "PATCH") return json({ mailingList: list });
        if (method === "DELETE") return json({ success: true });
        if (url.pathname.endsWith("/grants")) return json({ grants: [], page });
        if (url.pathname === "/api/v1/groups") {
          return json({ groups: [], page });
        }
        return json({ mailingLists: [list], page });
      }),
    );

    const container = mount(
      <>
        <GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();
    const button = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
    expect(container.querySelector("form")).toBeNull();
    await act(async () => {
      button("Add mailing list")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const createForm = container.querySelector("form")!;
    const email = createForm.querySelector<HTMLInputElement>('input[type="email"]')!;
    const textInputs = createForm.querySelectorAll<HTMLInputElement>(
      'input:not([type="email"]):not([type="checkbox"]):not([readonly])',
    );
    email.value = "consultation@lists.example.test";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    textInputs[0].value = "Consultation list";
    textInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    const selects = createForm.querySelectorAll<HTMLSelectElement>("select");
    selects[0].value = "consultation";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    selects[1].value = "eligible_categories";
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));
    selects[2].value = "members";
    selects[2].dispatchEvent(new Event("change", { bubbles: true }));
    selects[3].value = "moderated";
    selects[3].dispatchEvent(new Event("change", { bubbles: true }));
    const categoryA = createForm.querySelector<HTMLInputElement>("#group-mailing-list-create-auto-sync-categories-A")!;
    categoryA.checked = true;
    await act(async () => {
      categoryA.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const categoryH1 = createForm.querySelector<HTMLInputElement>(
      "#group-mailing-list-create-auto-sync-categories-H1",
    )!;
    categoryH1.checked = true;
    await act(async () => {
      categoryH1.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await act(async () => {
      createForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await settle();

    const created = requests.find(({ method }) => method === "POST");
    expect(created).toMatchObject({
      url: expect.objectContaining({ pathname: `/api/v1/groups/${GROUP_ID}/mailing-lists` }),
    });
    expect(groupMailingListCreateSchema.parse(created?.body)).toMatchObject({
      email: "consultation@lists.example.test",
      label: "Consultation list",
      purpose: "consultation",
      subscriptionDefault: "eligible_categories",
      postingPolicy: "members",
      moderationPolicy: "moderated",
      autoSyncCategories: ["A", "H1"],
    });
    expect(created?.body).not.toHaveProperty("groupId");

    // The row itself opens the editor; its activation names the list.
    expect(button("Manage Architecture discussion")).not.toBeUndefined();
    await act(async () => {
      button("Manage Architecture discussion")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    const saveButton = button("Save changes");
    expect(saveButton).not.toBeUndefined();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(requests.find(({ method }) => method === "PATCH")?.body).not.toHaveProperty("groupId");

    await settle();
    // The row's remaining command lives behind its menu, whose trigger
    // names the list.
    expect(rowActionControlNames(container)).toEqual(["Actions for Architecture discussion"]);
    await runRowAction(container, "Architecture discussion", "Archive");
    await settle();
    const archiveDialog = container.querySelector('[role="alertdialog"]');
    expect(archiveDialog).not.toBeNull();
    await act(async () => {
      Array.from(archiveDialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent === "Archive mailing list")
        ?.click();
    });
    await settle();
    expect(requests.some(({ method }) => method === "DELETE")).toBe(true);
  });

  it("loads forms, events, and audit history through server-backed group collections", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        const page = { limit: 50, offset: 0, total: 1, hasMore: false };
        if (url.pathname.endsWith("/forms")) {
          return json({
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
            page,
          });
        }
        if (url.pathname.endsWith("/events")) {
          return json({
            events: [
              {
                id: "architecture-workshop",
                ownerGroupId: GROUP_ID,
                seriesId: null,
                slug: "architecture-workshop",
                basePath: "/events/2026/architecture-workshop/",
                name: "Architecture workshop",
                timezone: "Europe/Amsterdam",
                startsAt: "2026-09-01T15:00:00.000Z",
                endsAt: "2026-09-01T16:00:00.000Z",
                profileKey: "workshop",
                sourceMode: "portal",
                registrationPolicy: "optional",
                visibility: "group_members",
                inviteLimitAttendee: 0,
                location: "Online",
                links: [],
                nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
                capabilities: ["view", "register"],
              },
            ],
            page,
          });
        }
        if (url.pathname.endsWith("/audit-log")) {
          return json({
            auditLog: [
              {
                id: "90000000-0000-4000-8000-000000000001",
                actor_type: "member",
                actor_id: "90000000-0000-4000-8000-000000000002",
                actor_display: "Group Chair",
                action: "group_updated",
                entity_type: "group",
                entity_id: GROUP_ID,
                details: { field: "description" },
                created_at: "2026-08-01T00:00:00.000Z",
              },
            ],
            page,
          });
        }
        if (url.pathname.endsWith("/votes")) {
          return json({
            votes: [
              {
                id: "b0000000-0000-4000-8000-000000000001",
                slug: "architecture-motion",
                title: "Architecture motion",
                description: "Adopt the architecture.",
                voteType: "motion",
                ownerGroupId: GROUP_ID,
                ownerGroupName: "Architecture Committee",
                electorateMode: "per_member",
                thresholdType: "simple_majority",
                eligibleCategories: null,
                opensAt: "2026-08-01T00:00:00.000Z",
                closesAt: "2026-09-01T00:00:00.000Z",
                currentRound: 1,
                status: "open",
                visibility: "private",
                publicDetailLevel: "outcome_only",
                createdAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
                capabilities: ["view", "participate"],
              },
            ],
            page,
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const forms = mount(<GroupForms groupId={GROUP_ID} canManage={false} />);
    const events = mount(<GroupEvents groupId={GROUP_ID} />);
    const audit = mount(<GroupAuditLog groupId={GROUP_ID} />);
    const votes = mount(<GroupVotes groupId={GROUP_ID} canManage={false} canParticipate />);
    await settle();

    expect(forms.textContent).toContain("Architecture survey");
    expect(events.textContent).toContain("Architecture workshop");
    expect(audit.textContent).toContain("group_updated");
    expect(votes.textContent).toContain("Architecture motion");
    expect(
      requests.map((url) => ({
        path: url.pathname,
        limit: url.searchParams.get("limit"),
        sort: url.searchParams.get("sort"),
      })),
    ).toEqual(
      expect.arrayContaining([
        { path: `/api/v1/groups/${GROUP_ID}/forms`, limit: "50", sort: "title" },
        { path: `/api/v1/groups/${GROUP_ID}/events`, limit: "50", sort: "next_occurrence_at" },
        { path: `/api/v1/groups/${GROUP_ID}/audit-log`, limit: "50", sort: "-createdAt" },
        { path: `/api/v1/groups/${GROUP_ID}/votes`, limit: "50", sort: "-closes_at" },
      ]),
    );
  });

  it("shows attendee details and owner actions from the canonical event projection", async () => {
    const requests: Array<{ url: URL; method: string }> = [];
    const event = {
      id: "architecture-workshop",
      ownerGroupId: GROUP_ID,
      seriesId: "70000000-0000-4000-8000-000000000001",
      slug: "architecture-workshop",
      basePath: "/events/2026/architecture-workshop/",
      name: "Architecture workshop",
      timezone: "Europe/Amsterdam",
      startsAt: "2026-09-01T15:00:00.000Z",
      endsAt: "2026-09-01T16:00:00.000Z",
      profileKey: "workshop",
      sourceMode: "hugo",
      registrationPolicy: "optional",
      visibility: "group_members",
      inviteLimitAttendee: 0,
      location: "Online",
      links: ["https://example.test/architecture-workshop"],
      nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      capabilities: ["view", "register", "manage_attendance", "manage"],
    } as const;
    const page = { limit: 50, offset: 0, total: 1, hasMore: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({ url, method: init.method ?? "GET" });
        if (url.pathname.endsWith("/events")) return json({ events: [event], page });
        if (url.pathname.endsWith(`/events/${event.id}/registration-config`)) {
          return json({
            event: { id: event.id, slug: event.slug, name: event.name },
            purpose: "event_registration",
            form: null,
            requiredTerms: [
              {
                termKey: "event-terms",
                version: "2026-01",
                required: true,
                contentRef: null,
                displayText: "I agree to the event terms",
                helpText: null,
              },
            ],
            allowedSessionTypes: [],
            eventDays: [],
          });
        }
        if (url.pathname.endsWith(`/events/${event.id}/registrations`)) {
          return json({
            registrations: [
              {
                id: "90000000-0000-4000-8000-000000000001",
                user_id: "90000000-0000-4000-8000-000000000002",
                user_email: "member@example.test",
                display_name: "Group Member",
                referral_code: null,
                status: "registered",
                attendance_type: "virtual",
                source_type: "direct",
                rsvp_events_json: null,
                has_bounced: false,
                sponsor_consent: false,
                custom_answers_json: null,
                dayWaitlistSummary: null,
                dayWaitlistCount: 0,
                attendanceChangeHistory: [],
                lastAttendanceChange: null,
                created_at: "2026-08-01T00:00:00.000Z",
                updated_at: "2026-08-01T00:00:00.000Z",
              },
            ],
            page,
            event: { id: event.id, slug: event.slug, name: event.name },
            stats: {
              byAttendanceType: { virtual: 1 },
              attendanceStatusByType: { virtual: { accepted: 1, waitlisted: 0 } },
              byStatus: { registered: 1 },
              bouncedCount: 0,
              consentCount: 1,
            },
          });
        }
        if (url.pathname.endsWith(`/events/${event.id}`)) return json({ event });
        if (url.pathname.endsWith("/grants")) return json({ grants: [], page });
        if (url.pathname === "/api/v1/groups") return json({ groups: [], page: { ...page, total: 0 } });
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = mount(<GroupEvents groupId={GROUP_ID} />);
    await settle();
    // The whole row opens the event now: the "Details" button in a nameless
    // last column was a control no keyboard could reach the row through, so
    // the table's own `rowAction` renders the link and stretches it.
    const open = Array.from(container.querySelectorAll("a, button")).find(
      (control) => control.textContent === `Open ${event.name}`,
    );
    expect(open).toBeDefined();
    await act(async () => {
      open?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    await settle();

    expect(requests.some(({ url }) => url.pathname.endsWith(`/events/${event.id}`))).toBe(true);
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${event.id}`);

    // The default tab is the overview, which shows the registration panel — not the settings form.
    expect(container.textContent).toContain("Registration");
    expect(container.textContent).toContain("Register for this event");
    expect(container.textContent).toContain("I agree to the event terms");
    expect(container.textContent).not.toContain("Attendees");
    expect(container.textContent).not.toContain("Manage meeting series");

    const tab = (label: string) => tabs(container).find((item) => item.textContent?.trim() === label);

    // Tab clicks navigate to the canonical URL (the mocked navigate is a no-op
    // spy here, so the resulting tab is verified below through the URL it
    // would produce, the same way a fresh page load resolves that URL).
    await act(async () => {
      tab("Registrations")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${event.id}/registrations`);

    await act(async () => {
      tab("Settings")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${event.id}/settings`);

    const back = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "← Back to events",
    );
    await act(async () => {
      back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events`);

    // The registrations URL resolves to the registrations tab.
    const registrationsView = mount(
      <GroupEvents groupId={GROUP_ID} initialEventId={event.id} initialEventTab="registrations" />,
    );
    await settle();
    await settle();
    expect(registrationsView.textContent).toContain("Attendees");
    expect(registrationsView.textContent).toContain("Group Member");
    expect(requests.some(({ url }) => url.pathname.endsWith(`/events/${event.id}/registrations`))).toBe(true);

    // The settings URL resolves to the settings tab, which surfaces the meeting-series link for a series event.
    const settingsView = mount(<GroupEvents groupId={GROUP_ID} initialEventId={event.id} initialEventTab="settings" />);
    await settle();
    await settle();
    expect(settingsView.textContent).toContain("Manage meeting series");
    expect(settingsView.querySelector(`a[href="#/groups/${GROUP_ID}/meetings"]`)).not.toBeNull();
  });
});
