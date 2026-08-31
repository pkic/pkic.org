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
