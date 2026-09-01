// @vitest-environment jsdom
/**
 * The member's own application history.
 *
 * The list is a master/detail pair inside one tab, so the assertions that
 * matter are the ones a screenshot cannot make: the table is named, the row's
 * activation is a real control rather than a handler on the `<tr>` that no
 * keyboard could reach, an empty history says so in a region that is
 * announced, and a failed request is stated in English.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { myApplicationsListResponseSchema, myApplicationDetailSchema } from "../../assets/shared/schemas/me";
import { MyApplications } from "../../assets/ts/member-flows/portal/sections/MyApplications";

const APPLICATION_ID = "00000000-0000-4000-8000-000000000401";
const SUBMITTED_AT = "2026-03-04T10:00:00.000Z";
const DECIDED_AT = "2026-04-01T10:00:00.000Z";

const summary = {
  id: APPLICATION_ID,
  stage: "ec_review" as const,
  membershipCategory: "F",
  createdAt: SUBMITTED_AT,
};

const detail = {
  id: APPLICATION_ID,
  applicantName: "Example Applicant",
  applicantEmail: "applicant@example.test",
  organizationName: "Example Organization",
  membershipCategory: "F",
  stage: "ec_review" as const,
  stageEnteredAt: DECIDED_AT,
  createdAt: SUBMITTED_AT,
  timeline: [
    { fromStage: null, toStage: "in_review" as const, note: null, createdAt: SUBMITTED_AT },
    { fromStage: "in_review" as const, toStage: "ec_review" as const, note: "Sent to the EC.", createdAt: DECIDED_AT },
  ],
  communications: [{ subject: "We received your application", body: "Thank you.", createdAt: SUBMITTED_AT }],
};

let container: HTMLDivElement;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function page(applications: unknown[]) {
  return { applications, page: { limit: 50, offset: 0, total: applications.length, hasMore: false } };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/**
 * Every request the surface makes, with the list and detail responses the
 * caller chooses. Responses are parsed through the shared schemas first, so a
 * fixture that has drifted from the contract fails here rather than being
 * asserted against.
 */
function stub(options: { list?: () => Response; detail?: () => Response } = {}) {
  const requests: Array<{ method: string; url: URL }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      requests.push({ method: init?.method ?? "GET", url });
      if (/\/applications\/[^/]+$/.test(url.pathname)) {
        return (options.detail ?? (() => json(myApplicationDetailSchema.parse(detail))))();
      }
      return (options.list ?? (() => json(myApplicationsListResponseSchema.parse(page([summary])))))();
    }),
  );
  return requests;
}

function mount(): HTMLElement {
  void act(() => render(<MyApplications />, container));
  return container;
}

/** The row's activation control, which the design system stretches over the row. */
function rowLink(root: ParentNode): HTMLElement {
  const link = root.querySelector<HTMLElement>("tbody .pk-table__row-link");
  if (!link) throw new Error("the row exposes no activation control");
  return link;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("my applications", () => {
  it("lists the caller's applications through the canonical bounded collection request", async () => {
    const requests = stub();

    const root = mount();
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.pathname).toBe("/api/v1/users/current/applications");
    expect(requests[0]?.url.searchParams.get("sort")).toBe("-createdAt");
    expect(requests[0]?.url.searchParams.get("limit")).toBe("50");
    expect(requests[0]?.url.searchParams.get("offset")).toBe("0");
    // The list is rendered from what the server returned, not filtered here.
    expect(root.textContent).toContain("EC review");
  });

  it("names the table and its columns, so it is identifiable among the tables on the page", async () => {
    stub();

    const root = mount();
    await settle();

    const caption = root.querySelector("caption");
    expect(caption?.textContent).toBe("Your membership applications");
    expect([...root.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "Category",
      "Status",
      "Submitted",
    ]);
    expect([...root.querySelectorAll("thead th")].every((cell) => cell.getAttribute("scope") === "col")).toBe(true);
  });

  it("opens the detail from a real control that names what it opens, not a handler on the row", async () => {
    const requests = stub();

    const root = mount();
    await settle();

    const row = root.querySelector("tbody tr");
    expect(row?.getAttribute("onclick")).toBeNull();

    const link = rowLink(root);
    expect(link.tagName).toBe("BUTTON");
    expect(link.textContent).toContain("Open the application submitted");

    await act(() => link.click());
    await settle();

    expect(requests.map(({ url }) => url.pathname)).toContain(`/api/v1/users/current/applications/${APPLICATION_ID}`);
    expect(root.textContent).toContain("Example Applicant");
    expect(root.textContent).toContain("Status history");
    // The status change reads as words, so the history does not rest on colour.
    expect(root.textContent).toContain("In review → ");
    expect(root.textContent).toContain("Sent to the EC.");
    expect(root.textContent).toContain("We received your application");
  });

  it("returns to the list from the detail view", async () => {
    stub();

    const root = mount();
    await settle();
    await act(() => rowLink(root).click());
    await settle();

    const back = [...root.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Back to applications"),
    );
    expect(back).toBeDefined();
    await act(() => back!.click());
    await settle();

    expect(root.querySelector("caption")?.textContent).toBe("Your membership applications");
  });

  it("says so in an announced region when no application is on file", async () => {
    stub({ list: () => json(myApplicationsListResponseSchema.parse(page([]))) });

    const root = mount();
    await settle();

    const status = [...root.querySelectorAll('[role="status"]')].find((node) =>
      node.textContent?.includes("No membership application is on file"),
    );
    expect(status).toBeDefined();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(0);
    // The table is still named, so the empty region is not an unnamed blank.
    expect(root.querySelector("caption")?.textContent).toBe("Your membership applications");
  });

  it("states a failed list request in English rather than as transport phrasing", async () => {
    stub({ list: () => json({ error: "Forbidden" }, 403) });

    const root = mount();
    await settle();

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(root.textContent).not.toContain("HTTP 403");
    expect(root.querySelector("table")).toBeNull();
  });

  it("states a failed detail request without pretending the application loaded", async () => {
    stub({ detail: () => json({ error: "Not found" }, 404) });

    const root = mount();
    await settle();
    await act(() => rowLink(root).click());
    await settle();

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This wasn't found");
    expect(root.textContent).not.toContain("Status history");
    // The way back is still there, so the reader is not stranded.
    expect(
      [...root.querySelectorAll("button")].some((button) => button.textContent?.includes("Back to applications")),
    ).toBe(true);
  });
});
