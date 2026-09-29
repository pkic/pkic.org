// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry } from "../../assets/shared/schemas/audit-log";
import { AuditLogSection } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/AuditLogSection";
import { ProposalAuditLog } from "../../assets/ts/components/proposals/ProposalAuditLog";
import { RegistrationAuditLogSection } from "../../assets/ts/member-flows/portal/sections/events/detail/registration-detail/RegistrationPanels";

const mounted: HTMLElement[] = [];

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input, location.origin);
  if (input instanceof URL) return input;
  return new URL(input.url, location.origin);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function auditEntry(id: string, action: string, actor: string): AuditLogEntry {
  return {
    id,
    created_at: "2026-08-21T12:00:00.000Z",
    actor_type: "admin",
    actor_id: null,
    actor_display: actor,
    action,
    entity_type: "audit_test",
    entity_id: id,
    details: null,
  };
}

function auditResponse(offset: number, firstAction: string, secondAction: string) {
  const isFirstPage = offset === 0;
  return {
    auditLog: [
      auditEntry(
        `audit-${offset}`,
        isFirstPage ? firstAction : secondAction,
        isFirstPage ? "First page actor" : "Second page actor",
      ),
    ],
    page: {
      limit: 50,
      offset,
      total: 51,
      hasMore: isFirstPage,
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function assertPagedAuditLog(
  node: ComponentChildren,
  endpoint: string,
  firstAction: string,
  firstRendered: string,
  secondAction: string,
  secondRendered: string,
): Promise<void> {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      requests.push(url);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return jsonResponse(auditResponse(offset, firstAction, secondAction));
    }),
  );

  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);

  await act(() => render(node, container));
  await settle();

  expect(requests).toHaveLength(1);
  expect(requests[0]?.pathname).toBe(endpoint);
  expect(requests[0]?.searchParams.get("limit")).toBe("50");
  expect(requests[0]?.searchParams.get("offset")).toBe("0");
  expect(requests[0]?.searchParams.get("sort")).toBe("-createdAt");
  expect(container.textContent).toContain(firstRendered);
  expect(container.textContent).not.toContain(secondRendered);

  const next = container.querySelector('button[aria-label="Next page"]');
  expect(next).toBeInstanceOf(HTMLButtonElement);
  await act(() => (next as HTMLButtonElement).click());
  await settle();

  expect(requests).toHaveLength(2);
  expect(requests[1]?.pathname).toBe(endpoint);
  expect(requests[1]?.searchParams.get("limit")).toBe("50");
  expect(requests[1]?.searchParams.get("offset")).toBe("50");
  expect(container.textContent).toContain(secondRendered);
  expect(container.textContent).not.toContain(firstRendered);
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("scoped audit-log server pagination", () => {
  it("pages proposal audit entries with the shared limit/offset pager", async () => {
    await assertPagedAuditLog(
      <AuditLogSection proposalId="proposal-1" enabled />,
      "/api/v1/proposals/proposal-1/audit-log",
      "proposal_edited",
      "Proposal updated",
      "proposal_decision_recorded",
      "Decision recorded",
    );
  });

  it("pages the canonical proposal audit endpoint through the shared audit UI", async () => {
    await assertPagedAuditLog(
      <ProposalAuditLog endpoint="/api/v1/proposals/proposal-1/audit-log" />,
      "/api/v1/proposals/proposal-1/audit-log",
      "proposal_decision_recorded",
      "Decision recorded",
      "proposal_review_upserted",
      "Review updated",
    );
  });

  it("says the audit log is unavailable, politely, when the viewer may not read it", () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<AuditLogSection proposalId="proposal-1" enabled={false} />, container));

    // Nothing the viewer can act on, so it is announced as a status rather
    // than as an alert, and it says which permission is missing.
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("Audit log access requires proposal review permission.");
    expect(container.querySelector("table")).toBeNull();
  });

  it("names each scoped audit table after the record whose history it is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(auditResponse(0, "proposal_edited", "proposal_edited")))),
    );
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);

    await act(() => render(<AuditLogSection proposalId="proposal-1" enabled />, container));
    await settle();

    // Four tables on a page all called "Audit history" are announced as four
    // identical tables, so each says whose history it is.
    expect(container.querySelector("table caption")?.textContent).toBe("Proposal history");
  });

  it("names the canonical proposal history and pairs each detail with its own term", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            auditLog: [
              {
                ...auditEntry("audit-detail", "proposal_edited", "Ada Lovelace"),
                details: { title: { from: "Old title", to: "New title" }, reviewer: "Grace" },
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
        ),
      ),
    );
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);

    await act(() => render(<ProposalAuditLog endpoint="/api/v1/proposals/proposal-1/audit-log" />, container));
    await settle();

    expect(container.querySelector("table caption")?.textContent).toBe("Proposal history");

    // The details used to be one run-on line reading "title: a → b reviewer:
    // Grace". Each key is now a term answered by its own value, and the pairs
    // are direct children of the list so both stay in the two-column grid.
    const list = container.querySelector("dl")!;
    expect([...list.querySelectorAll(":scope > dt")].map((dt) => dt.textContent)).toEqual(["title", "reviewer"]);
    const values = [...list.querySelectorAll(":scope > dd")].map((dd) => dd.textContent);
    expect(values[0]).toBe("Old title → New title");
    expect(values[1]).toBe("Grace");
  });

  it("pages registration audit entries with the shared limit/offset pager", async () => {
    await assertPagedAuditLog(
      <RegistrationAuditLogSection slug="event-2026" regId="registration-1" />,
      "/api/v1/events/event-2026/registrations/registration-1/audit",
      "registration_created",
      "registration_created",
      "registration_updated",
      "registration_updated",
    );
  });
});
