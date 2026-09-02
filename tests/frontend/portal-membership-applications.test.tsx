// @vitest-environment jsdom
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationDetailView } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationDetailView";
import { ApplicationsList } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationsList";
import { ApplicationTimelineCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationTimelineCard";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { chooseColumnFilter, columnFilterSummary } from "./helpers/column-menu";

const APPLICATION_ID = "00000000-0000-4000-8000-000000000201";
const NOW = "2026-08-27T12:00:00.000Z";

const detail = {
  id: APPLICATION_ID,
  applicantEmail: "applicant@example.test",
  applicantName: "Example Applicant",
  organizationName: "Example Organization",
  membershipCategory: "F",
  membershipCategoryLabel: "General Member",
  stage: "ec_review" as const,
  onHoldSubtype: null,
  assignedToUserId: null,
  createdAt: NOW,
  updatedAt: NOW,
  stageEnteredAt: NOW,
  answers: {},
  requestedWorkingGroups: [],
  events: [],
  communications: [],
  concerns: [],
  ecDecisions: [],
};

const categories = [
  {
    code: "F" as const,
    label: "General Member",
    description: null,
    displayOrder: 60,
    isIndividual: false,
    isVoting: true,
    revision: 0,
    updatedAt: NOW,
  },
];

let container: HTMLElement | null = null;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("portal membership-application management", () => {
  it("lists the D1 category label through only the canonical server-side collection API", async () => {
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
          applications: [detail],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    const open = vi.fn();
    const page = mount(<ApplicationsList onViewApplication={open} />);
    await settle();

    expect(page.textContent).toContain("General Member");
    expect(page.textContent).toContain("(F)");
    // Two reads of the same collection: the list itself, and the consultation
    // queue's one-row count probe beside it. Nothing else.
    expect(requests).toHaveLength(2);
    const list = requests.find((url) => !url.searchParams.has("stage"));
    expect(list?.pathname).toBe("/api/v1/members/applications");
    expect(list?.searchParams.get("limit")).toBe("50");
    expect(list?.searchParams.get("offset")).toBe("0");
    expect(list?.searchParams.get("sort")).toBe("-created_at");
    const probe = requests.find((url) => url.searchParams.get("stage") === "in_consultation");
    expect(probe?.pathname).toBe("/api/v1/members/applications");
    expect(probe?.searchParams.get("limit")).toBe("1");
    expect(requests.every((url) => !url.pathname.startsWith("/api/v1/admin/"))).toBe(true);

    // The row's control, not the row: the `<tr>` click handler this replaced
    // was unreachable by keyboard.
    void act(() => (page.querySelector("tbody .pk-table__row-link") as HTMLElement).click());
    expect(open).toHaveBeenCalledWith(APPLICATION_ID);
  });

  it("narrows by stage from the Stage column, sends it to the collection query, and states the consultation queue", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        // The queue's count probe reads `page.total` off a one-row page; the
        // list itself is empty at every stage.
        const total = url.searchParams.get("limit") === "1" ? 3 : 0;
        return json({ applications: [], page: { limit: 50, offset: 0, total, hasMore: false } });
      }),
    );

    const page = mount(<ApplicationsList onViewApplication={vi.fn()} />);
    await settle();

    // No select above the table: the stage filter is the Stage column's own.
    expect(page.querySelector('[role="toolbar"] select')).toBeNull();
    // And the table names itself, so several tables on one page are told apart.
    expect(page.querySelector("caption")?.textContent).toBe("Membership applications");
    // The default view is the server default: no `stage` on the list request.
    expect(requests.some((url) => !url.searchParams.has("stage"))).toBe(true);

    await chooseColumnFilter(page, "Stage", "In consultation");
    await settle();

    expect(requests.at(-1)?.searchParams.get("stage")).toBe("in_consultation");
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("50");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(columnFilterSummary(page, "Stage")).toBe("In consultation");
    // The consultation queue is a status region above the list, stating the
    // probe's count in words, announced without stealing focus.
    const banner = page.querySelector('[role="status"].pk-alert');
    expect(banner?.textContent).toContain("3 applications currently queued for member consultation");
  });

  it("says nothing about the consultation queue while it is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ applications: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );

    const page = mount(<ApplicationsList onViewApplication={vi.fn()} />);
    await settle();

    expect(page.querySelector('[role="status"].pk-alert')).toBeNull();
    expect(page.textContent).not.toContain("queued for member consultation");
  });

  it("states a refused application listing as a sentence instead of an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "no" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const page = mount(<ApplicationsList onViewApplication={vi.fn()} />);
    await settle();

    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(alert?.textContent).not.toContain("HTTP 403");
    expect(page.querySelector("table")).toBeNull();
  });

  it("heads the detail view with the applicant's name and a way back to the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/documents")) {
          return json({ documents: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } });
        }
        return json(detail);
      }),
    );

    const page = mount(
      <ApplicationDetailView
        applicationId={APPLICATION_ID}
        categories={categories}
        canWrite={false}
        canApprove={false}
      />,
    );
    await settle();

    // The name used to be a `<span>` carrying a legacy heading class, so the
    // page it heads had no heading at all in the outline.
    const heading = page.querySelector("h2");
    expect(heading?.textContent).toBe("Example Applicant");
    // Every card below it is a section titled one rung down, so the outline
    // does not skip a level.
    expect([...page.querySelectorAll("h3")].length).toBeGreaterThan(0);

    // The way back is the header's trail, not a back button dressed as one.
    const trail = page.querySelector('nav[aria-label="Breadcrumb"]');
    expect(trail).not.toBeNull();
    const backLink = trail!.querySelector<HTMLAnchorElement>("a");
    expect(backLink?.textContent).toBe("Membership applications");
    expect(backLink?.getAttribute("href")).toBe("#/membership/applications");
  });

  it("announces a detail that could not be loaded rather than rendering an empty page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const page = mount(
      <ApplicationDetailView applicationId={APPLICATION_ID} categories={categories} canWrite canApprove />,
    );
    await settle();

    // A blocking failure interrupts, and says what happened in English rather
    // than in transport phrasing.
    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(page.textContent).not.toContain("HTTP 403");
    expect(page.querySelector("h2")).toBeNull();
  });

  it("keeps a read-only reviewer view free of write and approval controls", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname.endsWith("/documents")) {
          return json({ documents: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } });
        }
        return json(detail);
      }),
    );

    const page = mount(
      <ApplicationDetailView
        applicationId={APPLICATION_ID}
        categories={categories}
        canWrite={false}
        canApprove={false}
      />,
    );
    await settle();

    expect(page.textContent).toContain("Example Applicant");
    expect(page.textContent).toContain("General Member");
    expect(page.textContent).not.toContain("Approve & run onboarding");
    expect(page.textContent).not.toContain("Send communication");
    expect(page.textContent).not.toContain("Add internal note");
    expect(page.textContent).not.toContain("staff override");
    expect([...page.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Edit")).toBe(false);
    expect(requests.every((url) => url.pathname.startsWith("/api/v1/members/applications"))).toBe(true);
  });

  it("renders write and approval controls only for their respective capabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/documents")) {
          return json({ documents: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } });
        }
        return json(detail);
      }),
    );

    const page = mount(
      <ApplicationDetailView applicationId={APPLICATION_ID} categories={categories} canWrite canApprove />,
    );
    await settle();

    expect(page.textContent).toContain("Approve & run onboarding");
    expect(page.textContent).toContain("Send communication");
    expect(page.textContent).toContain("Add internal note");
    expect(page.textContent).toContain("staff override");
    expect([...page.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Edit")).toBe(true);
  });

  it("only approves an application through the confirm dialog when the approval is confirmed", async () => {
    const requests: Array<{ method: string; pathname: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, pathname: url.pathname });
        if (url.pathname.endsWith("/documents")) {
          return json({ documents: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname.endsWith("/approve") && method === "POST") {
          return json({ success: true, memberId: "member-1" });
        }
        return json(detail);
      }),
    );

    const page = mount(
      <>
        <ConfirmDialogHost />
        <ApplicationDetailView applicationId={APPLICATION_ID} categories={categories} canWrite canApprove />
      </>,
    );
    await settle();

    function dialogButton(label: string): HTMLButtonElement {
      const button = [...page.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`missing button: ${label}`);
      return button;
    }

    await act(() => dialogButton("Approve & run onboarding").click());
    expect(page.textContent).toContain("Approve Example Applicant's application and run onboarding?");

    // Cancel: no approve request is sent.
    await act(() => dialogButton("Cancel").click());
    await settle();
    expect(requests.some((r) => r.pathname.endsWith("/approve"))).toBe(false);

    // Confirm: the dialog's own button runs the approval.
    await act(() => dialogButton("Approve & run onboarding").click());
    await act(() => dialogButton("Approve & run onboarding").click());
    await settle();
    const approveRequest = requests.find((r) => r.pathname.endsWith("/approve"));
    expect(approveRequest).toMatchObject({
      method: "POST",
      pathname: `/api/v1/members/applications/${APPLICATION_ID}/approve`,
    });
  });
});

describe("the application timeline card", () => {
  it("reads each stage change in the product's own words, not in stored keys", () => {
    const card = mount(
      <ApplicationTimelineCard
        detail={{
          ...detail,
          events: [
            { fromStage: null, toStage: "pending", actorUserId: null, note: null, createdAt: NOW },
            {
              fromStage: "in_review",
              toStage: "ec_review",
              actorUserId: null,
              note: "Escalated",
              createdAt: NOW,
            },
          ],
        }}
      />,
    );

    const entries = [...card.querySelectorAll("li")].map((item) => item.textContent);
    expect(entries[0]).toContain("Not yet in a stage");
    expect(entries[0]).toContain("Pending");
    expect(entries[1]).toContain("In review");
    expect(entries[1]).toContain("EC review");
    expect(card.textContent).not.toContain("ec_review");
    // The arrow is decorative; a word carries the direction for anyone who
    // cannot see it.
    expect(card.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe("→");
    expect(card.querySelector(".pk-sr-only")?.textContent).toBe("to");
    // The card is a named region among the several this screen renders.
    expect(card.querySelector('[aria-label="Timeline"]')).not.toBeNull();
  });

  it("announces an application with no history as a status region rather than an empty list", () => {
    const card = mount(<ApplicationTimelineCard detail={{ ...detail, events: [] }} />);

    expect(card.querySelector('[role="status"].pk-empty-state')?.textContent).toContain("No stage changes yet.");
    expect(card.querySelector("ul")).toBeNull();
  });
});
