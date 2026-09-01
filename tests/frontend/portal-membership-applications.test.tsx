// @vitest-environment jsdom
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationDetailView } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationDetailView";
import { ApplicationsList } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationsList";
import { ApplicationTimelineCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationTimelineCard";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";

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
    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/members/applications");
    expect(requests[0]?.searchParams.get("limit")).toBe("50");
    expect(requests[0]?.searchParams.get("offset")).toBe("0");
    expect(requests[0]?.searchParams.get("sort")).toBe("-created_at");
    expect(requests.every((url) => !url.pathname.startsWith("/api/v1/admin/"))).toBe(true);

    // The row's control, not the row: the `<tr>` click handler this replaced
    // was unreachable by keyboard.
    void act(() => (page.querySelector("tbody .pk-table__row-link") as HTMLElement).click());
    expect(open).toHaveBeenCalledWith(APPLICATION_ID);
  });

  it("names the stage filter and sends the chosen stage to the collection query", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return json({ applications: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const page = mount(<ApplicationsList onViewApplication={vi.fn()} />);
    await settle();

    // A toolbar filter with no visible label still says which list it filters.
    const filter = page.querySelector<HTMLSelectElement>("select[aria-label='Filter applications by stage']")!;
    expect(filter).not.toBeNull();
    // And the table it controls names itself, so several tables on one page
    // are told apart.
    expect(page.querySelector("caption")?.textContent).toBe("Membership applications");

    filter.value = "in_consultation";
    await act(async () => {
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(requests.some((url) => url.searchParams.get("stage") === "in_consultation")).toBe(true);
    // The consultation banner is a status region, announced without stealing
    // focus from the filter that revealed it.
    expect(page.querySelector('[role="status"].pk-alert')?.textContent).toContain("queued for member consultation");
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

    const onBack = vi.fn();
    const page = mount(
      <ApplicationDetailView
        applicationId={APPLICATION_ID}
        categories={categories}
        canWrite={false}
        canApprove={false}
        onBack={onBack}
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

    const back = [...page.querySelectorAll("button")].find((button) => button.textContent?.includes("Back to list"));
    expect(back).toBeDefined();
    void act(() => back!.click());
    expect(onBack).toHaveBeenCalledTimes(1);
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
      <ApplicationDetailView
        applicationId={APPLICATION_ID}
        categories={categories}
        canWrite
        canApprove
        onBack={vi.fn()}
      />,
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
        onBack={vi.fn()}
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
      <ApplicationDetailView
        applicationId={APPLICATION_ID}
        categories={categories}
        canWrite
        canApprove
        onBack={vi.fn()}
      />,
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
        <ApplicationDetailView
          applicationId={APPLICATION_ID}
          categories={categories}
          canWrite
          canApprove
          onBack={vi.fn()}
        />
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
