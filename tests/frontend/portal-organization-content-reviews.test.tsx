// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationContentReviewRejectSchema } from "../../assets/shared/schemas/organization-content-reviews";
import { OrganizationContentReviews } from "../../assets/ts/member-flows/portal/sections/OrganizationContentReviews";
import { chooseColumnFilter, columnFilterOptions, columnFilterSummary } from "./helpers/column-menu";

const REVIEW_ID = "00000000-0000-4000-8000-000000000101";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000102";
const SUBMITTER_ID = "00000000-0000-4000-8000-000000000103";

const summary = {
  id: REVIEW_ID,
  organizationId: ORGANIZATION_ID,
  submittedByUserId: SUBMITTER_ID,
  proposedChanges: { slogan: "A clearer slogan" },
  hasLogoChange: false,
  status: "pending" as const,
  reviewerUserId: null,
  reviewerNote: null,
  submittedAt: "2026-08-27T12:00:00.000Z",
  reviewedAt: null,
  organizationName: "Example Member",
  submitterName: "Pat Reviewer",
  submitterEmail: "pat@example.test",
};

let container: HTMLElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

/**
 * The control a visible label actually points at.
 *
 * Looking the control up through its `for`/`id` pair rather than by a
 * hard-coded id is itself the assertion: a label that names nothing, or names
 * an element that is not rendered, fails here instead of passing silently the
 * way a `querySelector("#some-id")` would once the id moved into `Field`.
 */
function controlFor<T extends HTMLElement>(labelText: string): T {
  const label = [...(container?.querySelectorAll("label") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === labelText,
  );
  expect(label, `no label reading "${labelText}"`).toBeInstanceOf(HTMLLabelElement);
  const id = label?.getAttribute("for");
  expect(id, `the label "${labelText}" points at nothing`).toBeTruthy();
  const control = container?.querySelector<T>(`[id="${id ?? ""}"]`);
  expect(control, `the label "${labelText}" points at a control that is not rendered`).toBeTruthy();
  return control!;
}

function describedBy(control: HTMLElement): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[id="${control.getAttribute("aria-describedby") ?? ""}"]`) ?? null;
}

function captions(): string[] {
  return [...(container?.querySelectorAll("caption") ?? [])].map((node) => node.textContent?.trim() ?? "");
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("portal organization content reviews", () => {
  it("loads, reviews, and rejects through only the canonical organizations API", async () => {
    const requests: Array<{ method: string; url: URL; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        if (method === "GET" && url.pathname.endsWith(`/${REVIEW_ID}`)) {
          return json({
            review: {
              ...summary,
              diff: [{ field: "slogan", current: "Old slogan", proposed: "A clearer slogan" }],
              logoStagingR2Key: null,
              currentLogoR2Key: null,
            },
          });
        }
        if (method === "POST" && url.pathname.endsWith(`/${REVIEW_ID}/reject`)) {
          return json({
            review: {
              ...summary,
              status: "rejected",
              reviewerUserId: "00000000-0000-4000-8000-000000000104",
              reviewerNote: "Please use a factual slogan.",
              reviewedAt: "2026-08-27T13:00:00.000Z",
            },
          });
        }
        return json({ reviews: [summary], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<OrganizationContentReviews />, container!));
    await settle();

    expect(container.textContent).toContain("Example Member");
    expect(requests[0]?.url.pathname).toBe("/api/v1/organizations/content-reviews");
    expect(requests[0]?.url.searchParams.get("status")).toBe("pending");
    expect(requests[0]?.url.searchParams.get("sort")).toBe("-submittedAt");
    expect(requests[0]?.url.searchParams.get("limit")).toBe("50");

    // The row is opened by a real button whose name says what it opens, not by
    // a click handler on the `<tr>` that no keyboard could reach.
    await act(async () => button("Open the content review for Example Member")?.click());
    await settle();
    expect(container.textContent).toContain("Old slogan");
    expect(container.textContent).toContain("A clearer slogan");

    // Both tables name themselves, so a screen reader listing the tables on
    // this page does not read out two tables called nothing.
    expect(captions()).toEqual(
      expect.arrayContaining(["Organization content reviews", "Proposed changes for Example Member"]),
    );

    const note = controlFor<HTMLTextAreaElement>("Reviewer note");
    expect(note.tagName).toBe("TEXTAREA");
    expect(note.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(note)?.textContent).toContain("Required to reject");

    await act(async () => {
      note.value = "Please use a factual slogan.";
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    await act(async () => button("Reject")?.click());
    await settle();

    const rejection = requests.find((request) => request.method === "POST");
    // The body is checked against the endpoint's own contract rather than a
    // literal copy of what the component sent, which would only restate it.
    expect(organizationContentReviewRejectSchema.parse(rejection?.body)).toEqual({
      reviewerNote: "Please use a factual slogan.",
    });
    expect(rejection?.url.pathname).toBe(`/api/v1/organizations/content-reviews/${REVIEW_ID}/reject`);
    expect(requests.every((request) => !request.url.pathname.startsWith("/api/v1/admin/"))).toBe(true);
    expect(requests.every((request) => !request.url.pathname.startsWith("/api/v1/system/"))).toBe(true);
  });

  it("blocks a note-less rejection on the field itself rather than only in a toast", async () => {
    const requests: Array<{ method: string; url: URL }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, url });
        if (method === "GET" && url.pathname.endsWith(`/${REVIEW_ID}`)) {
          return json({ review: { ...summary, diff: [], logoStagingR2Key: null, currentLogoR2Key: null } });
        }
        return json({ reviews: [summary], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<OrganizationContentReviews />, container!));
    await settle();
    await act(async () => button("Open the content review for Example Member")?.click());
    await settle();

    // A logo-only submission has no field changes, and the table says so
    // instead of rendering an empty grid.
    expect(container.textContent).toContain("No field changes (logo only).");

    await act(async () => button("Reject")?.click());
    await settle();

    // Refused by the rejection contract the route parses, on the field.
    const note = controlFor<HTMLTextAreaElement>("Reviewer note");
    expect(note.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
    expect(note.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(note);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("Write the reason for the rejection");
    expect(document.activeElement).toBe(note);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("marks the note when the server refuses it, and keeps the submission open", async () => {
    let rejected = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        if (method === "GET" && url.pathname.endsWith(`/${REVIEW_ID}`)) {
          return json({ review: { ...summary, diff: [], logoStagingR2Key: null, currentLogoR2Key: null } });
        }
        if (method === "POST" && url.pathname.endsWith(`/${REVIEW_ID}/reject`)) {
          rejected += 1;
          return json(
            {
              error: {
                code: "VALIDATION",
                message: "Invalid request",
                details: { fieldErrors: { reviewerNote: ["Notes must not contain links."] } },
              },
            },
            400,
          );
        }
        return json({ reviews: [summary], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<OrganizationContentReviews />, container!));
    await settle();
    await act(async () => button("Open the content review for Example Member")?.click());
    await settle();

    const note = controlFor<HTMLTextAreaElement>("Reviewer note");
    await act(async () => {
      note.value = "See https://example.test";
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Reject")?.click());
    await settle();

    // The refusal lands on the field the server named, the way the
    // contract's own refusal would, and the note survives it.
    expect(rejected).toBe(1);
    expect(note.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
    expect(describedBy(note)?.textContent).toContain("Notes must not contain links.");
    expect(document.activeElement).toBe(note);
    expect(note.value).toBe("See https://example.test");
    expect(button("Reject")).toBeDefined();
  });

  it("opens on the pending queue and sends a status chosen from the Status column back to D1", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return json({ reviews: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<OrganizationContentReviews />, container!));
    await settle();
    // The queue's default is what needs a decision, sent as the contract's
    // `status` rather than left to the server, which would list everything.
    expect(requests[0]?.searchParams.get("status")).toBe("pending");
    expect(container.textContent).toContain("No organization content submissions match the current filters.");

    // No select above the table: the filter is the Status column's own, in
    // its menu, with the pending queue as its open state and no "all
    // statuses" — a moderation queue is not an archive.
    expect(container.querySelector('[role="toolbar"] select')).toBeNull();
    expect(columnFilterOptions(container, "Status")).toEqual(["Pending", "Approved", "Rejected", "Withdrawn"]);

    await chooseColumnFilter(container, "Status", "Approved");
    await settle();

    expect(requests.at(-1)?.searchParams.get("status")).toBe("approved");
    // The head says what the column is narrowed to.
    expect(columnFilterSummary(container, "Status")).toBe("Approved");

    // Choosing the open state again drops back to the queue's default.
    await chooseColumnFilter(container, "Status", "Pending");
    await settle();
    expect(requests.at(-1)?.searchParams.get("status")).toBe("pending");
    expect(columnFilterSummary(container, "Status")).toBeUndefined();
  });

  it("renders a server error instead of presenting an empty queue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          { error: { code: "TEMPORARY_FAILURE", message: "The moderation queue is temporarily unavailable." } },
          503,
        ),
      ),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<OrganizationContentReviews />, container!));
    await settle();

    expect(container.textContent).toContain("The moderation queue is temporarily unavailable.");
    expect(container.textContent).not.toContain("No pending organization content submissions.");
  });
});
