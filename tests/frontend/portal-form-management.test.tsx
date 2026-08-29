// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formDetailResponseSchema,
  formSubmissionStatsResponseSchema,
  formsListResponseSchema,
} from "../../assets/shared/schemas/form-management";
import {
  EventFormResponses,
  FormManagementDetail,
  FormManagementList,
} from "../../assets/ts/components/forms/management/FormManagement";

const mounted: HTMLElement[] = [];

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

function formListResponse(): Response {
  return new Response(
    JSON.stringify(
      formsListResponseSchema.parse({
        forms: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            key: "member-feedback",
            scope_type: "global",
            scope_ref: null,
            purpose: "feedback",
            status: "active",
            title: "Member feedback",
            description: null,
            created_at: "2026-08-29T10:00:00.000Z",
            updated_at: "2026-08-29T10:00:00.000Z",
            event_slug: null,
            event_name: null,
            field_count: 2,
            placement_count: 1,
            submission_count: 4,
          },
        ],
        page: { limit: 25, offset: 0, total: 1, hasMore: false },
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function communityFormDetailResponse(): Response {
  return new Response(
    JSON.stringify(
      formDetailResponseSchema.parse({
        form: {
          id: "00000000-0000-4000-8000-000000000002",
          key: "community-survey",
          scope_type: "community",
          scope_ref: "00000000-0000-4000-8000-000000000003",
          purpose: "survey",
          status: "active",
          title: "Community survey",
          description: null,
          created_at: "2026-08-29T10:00:00.000Z",
          updated_at: "2026-08-29T10:00:00.000Z",
        },
        fields: [],
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function emptyStatsResponse(): Response {
  return new Response(
    JSON.stringify(
      formSubmissionStatsResponseSchema.parse({
        form: {
          id: "form-2",
          key: "community-survey",
          title: "Community survey",
          purpose: "survey",
          placement: null,
        },
        total: 0,
        stats: [],
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal form management", () => {
  it("uses the canonical forms endpoint and keeps a reader read-only", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return formListResponse();
      }),
    );

    const container = mount(<FormManagementList canWrite={false} onOpenForm={vi.fn()} />);
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/forms");
    expect(requests.some((request) => request.pathname.startsWith("/api/v1/admin/forms"))).toBe(false);
    expect(container.textContent).toContain("Member feedback");
    expect(container.textContent).not.toContain("New form");
    expect(container.textContent).not.toContain("Archive/Delete");
  });

  it("shows authoring controls only to a form writer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => formListResponse()),
    );

    const container = mount(<FormManagementList canWrite onOpenForm={vi.fn()} />);
    await settle();

    expect(container.textContent).toContain("New form");
  });

  it("does not offer global mutations for a community-owned form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return url.pathname.endsWith("/submissions/stats") ? emptyStatsResponse() : communityFormDetailResponse();
      }),
    );

    const container = mount(<FormManagementDetail formKey="community-survey" canWrite onBack={vi.fn()} />);
    await settle();

    expect(container.textContent).toContain("Community survey");
    expect(container.textContent).not.toContain("Edit");
    expect(container.textContent).not.toContain("Archive/Delete");
  });

  it("uses the event-owned catalogue rather than the global form resource for event responses", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return formListResponse();
      }),
    );

    mount(<EventFormResponses eventSlug="pqc-2026" purpose="proposal_submission" />);
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/events/pqc-2026/forms");
    expect(requests[0]?.searchParams.get("purpose")).toBe("proposal_submission");
  });
});
