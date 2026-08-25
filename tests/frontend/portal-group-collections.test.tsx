// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupAuditLog } from "../../assets/ts/member-flows/portal/sections/management/GroupAuditLog";
import { GroupEvents } from "../../assets/ts/member-flows/portal/sections/management/GroupEvents";
import { GroupForms } from "../../assets/ts/member-flows/portal/sections/management/GroupForms";
import { GroupMailingLists } from "../../assets/ts/member-flows/portal/sections/management/GroupMailingLists";
import { GroupVotes } from "../../assets/ts/member-flows/portal/sections/management/GroupVotes";

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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal selected-group collections", () => {
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
                name: "Architecture workshop",
                timezone: "Europe/Amsterdam",
                startsAt: "2026-09-01T15:00:00.000Z",
                endsAt: "2026-09-01T16:00:00.000Z",
                profileKey: "workshop",
                sourceMode: "portal",
                registrationPolicy: "optional",
                location: "Online",
                links: [],
                nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
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

    const forms = mount(<GroupForms groupId={GROUP_ID} />);
    const events = mount(<GroupEvents groupId={GROUP_ID} />);
    const audit = mount(<GroupAuditLog groupId={GROUP_ID} />);
    const votes = mount(<GroupVotes groupId={GROUP_ID} />);
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

  it("updates a mailing-list preference through its selected group context", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    let preference: "subscribed" | "unsubscribed" | null = null;
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
        const subscription = {
          mailingList: {
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
          eligible: true,
          defaultSubscribed: true,
          preference,
          effectiveSubscribed: preference !== "unsubscribed",
        } as const;
        if (method === "PUT") {
          preference = (body as { preference: typeof preference }).preference;
          return json({ success: true, subscription: { ...subscription, preference, effectiveSubscribed: false } });
        }
        return json({ subscriptions: [subscription], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }),
    );

    const container = mount(<GroupMailingLists groupId={GROUP_ID} />);
    await settle();
    expect(container.textContent).toContain("Architecture discussion");
    expect(container.textContent).toContain("Subscribed");

    const select = container.querySelector<HTMLSelectElement>("select")!;
    select.value = "unsubscribed";
    await act(async () => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await settle();

    expect(requests.find(({ method }) => method === "PUT")).toMatchObject({
      url: expect.objectContaining({
        pathname: `/api/v1/groups/${GROUP_ID}/mailing-lists/a0000000-0000-4000-8000-000000000001/subscription`,
      }),
      body: { preference: "unsubscribed" },
    });
    expect(requests.filter(({ method }) => method === "GET")).toHaveLength(2);
    expect(container.textContent).toContain("Not subscribed");
  });
});
