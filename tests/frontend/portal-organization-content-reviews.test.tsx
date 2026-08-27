// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationContentReviews } from "../../assets/ts/member-flows/portal/sections/OrganizationContentReviews";

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

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("portal organization content reviews", () => {
  it("loads, reviews, and rejects through only the canonical system API", async () => {
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
    expect(requests[0]?.url.pathname).toBe("/api/v1/system/organization-content-reviews");
    expect(requests[0]?.url.searchParams.get("status")).toBe("pending");
    expect(requests[0]?.url.searchParams.get("sort")).toBe("-submittedAt");
    expect(requests[0]?.url.searchParams.get("limit")).toBe("50");

    await act(async () => button("Example Member")?.click());
    await settle();
    expect(container.textContent).toContain("Old slogan");
    expect(container.textContent).toContain("A clearer slogan");

    const note = container.querySelector<HTMLTextAreaElement>("#organization-content-review-note")!;
    await act(async () => {
      note.value = "Please use a factual slogan.";
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    await act(async () => button("Reject")?.click());
    await settle();

    const rejection = requests.find((request) => request.method === "POST");
    expect(rejection).toMatchObject({
      method: "POST",
      body: { reviewerNote: "Please use a factual slogan." },
    });
    expect(rejection?.url.pathname).toBe(`/api/v1/system/organization-content-reviews/${REVIEW_ID}/reject`);
    expect(requests.every((request) => !request.url.pathname.startsWith("/api/v1/admin/"))).toBe(true);
  });

  it("renders a status-scoped empty page and sends status changes back to D1", async () => {
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
    expect(container.textContent).toContain("No pending organization content submissions.");

    const status = container.querySelector<HTMLSelectElement>("#organization-content-review-status")!;
    await act(async () => {
      status.value = "approved";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await settle();

    expect(requests.at(-1)?.searchParams.get("status")).toBe("approved");
    expect(container.textContent).toContain("No approved organization content submissions.");
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
