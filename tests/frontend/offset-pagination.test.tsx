// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { eventPromotersListResponseSchema } from "../../assets/shared/schemas/admin-event-promoters";
import {
  donationPromotersListResponseSchema,
  donationsListResponseSchema,
} from "../../assets/shared/schemas/admin-donations";
import { pageInfoSchema } from "../../assets/shared/schemas/pagination";
import { ApiDataTable } from "../../assets/ts/admin/components/ApiDataTable";
import { ApplicationDocumentsCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationDocumentsCard";
import { Donations } from "../../assets/ts/admin/sections/Donations";
import { Email } from "../../assets/ts/admin/sections/Email";
import { DueWorkTable } from "../../assets/ts/admin/sections/due-work/DueWorkTable";
import { Promoters } from "../../assets/ts/admin/sections/events/detail/Promoters";
import { Pager } from "../../assets/ts/components/Pager";
import { useApiPage } from "../../assets/ts/hooks/useApiPage";
import { useOffsetPager } from "../../assets/ts/hooks/useOffsetPager";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

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

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pageFor(url: URL, total = 60, rowCount = 1) {
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return { limit, offset, total, hasMore: offset + rowCount < total };
}

function nextButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(".pagination .page-item:last-child button") as HTMLButtonElement;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("canonical offset pagination", () => {
  it("enforces first and last bounds, bounded jumps, totals, and page-size resets", () => {
    let pager: ReturnType<typeof useOffsetPager> | undefined;
    function Harness() {
      pager = useOffsetPager(25);
      return null;
    }
    mount(<Harness />);

    let props = pager!.pagerProps({ hasMore: true, rowCount: 25, total: 60 });
    expect(props).toMatchObject({ page: 1, pageSize: 25, offset: 0, rowCount: 25, total: 60, hasMore: true });
    void act(() => props.onPrev());
    expect(pager!.offset).toBe(0);

    void act(() => props.onJump(99));
    expect(pager!.offset).toBe(50);
    props = pager!.pagerProps({ hasMore: false, rowCount: 10, total: 60, serverOffset: 50 });
    expect(props.page).toBe(3);
    void act(() => props.onNext());
    expect(pager!.offset).toBe(50);

    void act(() => props.onJump(-4));
    expect(pager!.offset).toBe(0);
    void act(() => pager!.pagerProps({ hasMore: true, rowCount: 25, total: 60 }).onPageSizeChange(50));
    expect(pager!.pageSize).toBe(50);
    expect(pager!.offset).toBe(0);

    void act(() => pager!.pagerProps({ hasMore: true, rowCount: 50, total: 60 }).onNext());
    expect(pager!.offset).toBe(50);
    void act(() => pager!.resetAll());
    expect(pager!.pageSize).toBe(25);
    expect(pager!.offset).toBe(0);
  });

  it("drives useApiPage and resets a stale page when collection parameters change", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse({ items: [{ id: url.searchParams.get("offset") ?? "0" }], page: pageFor(url) });
      }),
    );
    const responseSchema = z.object({ items: z.array(z.object({ id: z.string() })), page: pageInfoSchema });

    function Harness() {
      const [filter, setFilter] = useState("open");
      const listing = useApiPage("/api/items", { filter }, responseSchema, (data) => data.items, 25);
      return (
        <div>
          <button data-filter onClick={() => setFilter("closed")}>
            Filter
          </button>
          {listing.pagerProps && <Pager {...listing.pagerProps} />}
        </div>
      );
    }

    const container = mount(<Harness />);
    await settle();
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("25");
    expect(container.querySelector(".adm-pager-range")?.textContent).toBe("1–1 of 60");

    void act(() => nextButton(container).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");

    const requestsBeforeFilter = requests.length;
    void act(() => (container.querySelector("[data-filter]") as HTMLButtonElement).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("filter")).toBe("closed");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(requests.slice(requestsBeforeFilter)).toHaveLength(1);
  });

  it("keeps generic portal group search server-side while paging the joined view", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse({
          groups: [{ id: url.searchParams.get("offset") ?? "0" }],
          page: pageFor(url, 60),
        });
      }),
    );
    const responseSchema = z.object({
      groups: z.array(z.object({ id: z.string() })),
      page: pageInfoSchema,
    });

    function Harness() {
      const listing = useApiPage(
        "/api/v1/me/groups",
        { view: "joined", q: "alpha" },
        responseSchema,
        (data) => data.groups,
        25,
      );
      return <>{listing.pagerProps && <Pager {...listing.pagerProps} />}</>;
    }

    const container = mount(<Harness />);
    await settle();
    expect(requests.at(-1)?.searchParams.get("view")).toBe("joined");
    expect(requests.at(-1)?.searchParams.has("typeKey")).toBe(false);
    expect(requests.at(-1)?.searchParams.get("q")).toBe("alpha");
    void act(() => nextButton(container).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");
    expect(requests.at(-1)?.searchParams.get("q")).toBe("alpha");
  });

  it("makes ApiDataTable reset pagination for filters, search, and sorting", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse({ rows: [{ id: "row", name: "Ada" }], page: pageFor(url) });
      }),
    );
    const responseSchema = z.object({
      rows: z.array(z.object({ id: z.string(), name: z.string() })),
      page: pageInfoSchema,
    });

    function Harness() {
      const [status, setStatus] = useState("open");
      return (
        <div>
          <button data-filter onClick={() => setStatus("closed")}>
            Filter
          </button>
          <ApiDataTable
            endpoint="/api/table"
            responseSchema={responseSchema}
            resolve={(data) => data.rows}
            resolvePage={(data) => data.page}
            params={{ status }}
            paginate
            initialPageSize={25}
            searchPlaceholder="Search"
            columns={[
              {
                header: "Name",
                cell: (row) => row.name,
                sort: { asc: "name", desc: "-name" },
              },
            ]}
            rowKey={(row) => row.id}
          />
        </div>
      );
    }

    const container = mount(<Harness />);
    await settle();
    void act(() => nextButton(container).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = "Ada";
    void act(() => {
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Ada");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");

    void act(() => nextButton(container).click());
    await settle();
    void act(() => (container.querySelector(".tbl-sort-btn") as HTMLButtonElement).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("sort")).toBe("-name");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");

    void act(() => nextButton(container).click());
    await settle();
    const requestsBeforeFilter = requests.length;
    void act(() => (container.querySelector("[data-filter]") as HTMLButtonElement).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("status")).toBe("closed");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(requests.slice(requestsBeforeFilter)).toHaveLength(1);
  });

  it("publishes table summary data after load without updating state during render", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse(
          donationsListResponseSchema.parse({
            donations: [
              {
                id: "donation-1",
                checkout_session_id: "cs_test_1",
                payment_intent_id: null,
                name: "Ada Lovelace",
                email: "ada@example.test",
                organization: null,
                currency: "usd",
                gross_amount: 1000,
                net_amount: null,
                source: null,
                status: "completed",
                payment_method_type: null,
                session_expires_at: null,
                settled_amount: null,
                settled_currency: null,
                created_at: "2026-01-01T00:00:00Z",
                completed_at: "2026-01-01T00:00:00Z",
              },
            ],
            page: pageFor(url, 1),
            summary: { byStatus: { completed: 1 }, backfillable: 0, syncable: 0 },
          }),
        );
      }),
    );

    const container = mount(<Donations />);
    await settle();

    expect(container.textContent).toContain("All");
    expect(container.textContent).toContain("1");
    expect(requests).toHaveLength(1);
  });

  it("loads application documents through the shared server-side table contract", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return jsonResponse({
          documents: [
            {
              id: offset === 0 ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002",
              filename: offset === 0 ? "first.pdf" : "second.pdf",
              mimeType: "application/pdf",
              fileSizeBytes: 2048,
              uploadedAt: "2026-08-21T08:00:00.000Z",
              uploadedByEmail: "applicant@example.test",
            },
          ],
          page: { limit: 10, offset, total: 11, hasMore: offset === 0 },
        });
      }),
    );

    const container = mount(<ApplicationDocumentsCard applicationId="00000000-0000-4000-8000-000000000010" />);
    await settle();

    expect(requests.at(-1)?.pathname).toBe(
      "/api/v1/system/membership-applications/00000000-0000-4000-8000-000000000010/documents",
    );
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("10");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(requests.at(-1)?.searchParams.get("sort")).toBe("-uploadedAt");
    expect(container.textContent).toContain("first.pdf");
    expect(container.textContent).not.toContain("second.pdf");

    void act(() => nextButton(container).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("10");
    expect(container.textContent).toContain("second.pdf");
    expect(container.textContent).not.toContain("first.pdf");
  });

  it("uses the shared pager for donation and event promoter collections", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        if (url.pathname === "/api/v1/admin/donations/promoters") {
          return jsonResponse(
            donationPromotersListResponseSchema.parse({
              promoters: [
                {
                  code: "ada",
                  name: "Ada",
                  checkout_session_id: null,
                  clicks: 1,
                  own_gross: 0,
                  own_gross_usd: 0,
                  own_currency: null,
                  attributed_total: 0,
                  attributed_completed: 0,
                  attributed_gross: 0,
                  attributed_gross_usd: 0,
                  currency: null,
                  created_at: "2026-01-01T00:00:00Z",
                },
              ],
              page: pageFor(url),
              summary: {
                promoterCount: 60,
                totalOwnGrossUsd: 0,
                totalAttributedGrossUsd: 0,
                totalClicks: 1,
                totalAttributedCompleted: 0,
              },
            }),
          );
        }
        return jsonResponse(
          eventPromotersListResponseSchema.parse({
            eventSlug: "summit",
            view: "promoters",
            promoters: [
              {
                user_id: "user-1",
                email: "ada@example.test",
                first_name: "Ada",
                last_name: "Lovelace",
                organization: null,
                job_title: null,
                headshot_url: null,
                invites_sent: 1,
                invites_accepted: 1,
                invites_declined: 0,
                invites_expired: 0,
                invite_conversion_rate: 100,
                last_invite_at: null,
                referral_codes_issued: 0,
                referral_clicks: 0,
                referral_conversions: 0,
                impact_score: 1,
              },
            ],
            referralCodes: [],
            page: pageFor(url),
            summary: {
              activePromoters: 60,
              promotersWithRegistrations: 1,
              totalInvitesSent: 1,
              totalInvitesAccepted: 1,
              totalReferralClicks: 0,
              totalReferralConversions: 0,
              referralCodeCount: 0,
            },
          }),
        );
      }),
    );

    const donations = mount(<Donations subTab="promoters" />);
    await settle();
    void act(() => nextButton(donations).click());
    await settle();
    expect(requests.at(-1)?.pathname).toBe("/api/v1/admin/donations/promoters");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("50");
    void act(() => render(null, donations));

    const eventPromoters = mount(<Promoters slug="summit" />);
    await settle();
    void act(() => nextButton(eventPromoters).click());
    await settle();
    expect(requests.at(-1)?.pathname).toBe("/api/v1/admin/events/summit/promoters");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("50");

    requests.length = 0;
    void act(() => render(<Promoters slug="summit" subTab="codes" />, eventPromoters));
    await settle();
    const codeViewRequests = requests.filter((url) => url.searchParams.get("view") === "codes");
    expect(codeViewRequests.map((url) => url.searchParams.get("offset"))).toEqual(["0"]);
  });

  it("uses the shared pager for email outbox and due-work filters", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        if (url.pathname === "/api/v1/admin/email/outbox") {
          return jsonResponse({
            outbox: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                eventSlug: null,
                eventName: null,
                templateKey: "notice",
                templateVersion: 1,
                recipientEmail: "ada@example.test",
                recipientName: "Ada",
                subject: "Notice",
                messageType: "transactional",
                provider: "test",
                providerMessageId: null,
                status: "queued",
                attempts: 0,
                sendAfter: "2026-01-01T00:00:00Z",
                lastError: null,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                sentAt: null,
                bccRecipientCount: 0,
                hasCalendarInvite: false,
                hasBadgeAttachment: false,
                usesDirectBody: false,
                hasCustomText: false,
              },
            ],
            page: pageFor(url),
            summary: {
              total: 60,
              byStatus: { queued: 60 },
              byMessageType: { transactional: 60 },
              topTemplates: [],
              dueNow: 1,
              dueByStatus: { queued: 1 },
              nextSendAfter: "2026-01-01T00:00:00Z",
            },
          });
        }
        return jsonResponse({
          items: [
            {
              bucket: "outbox",
              typeLabel: "Email",
              title: "Notice",
              subtitle: null,
              context: "Outbox",
              detail: null,
              dueAt: "2026-01-01T00:00:00Z",
              statusKey: "queued",
              statusLabel: "Queued",
            },
          ],
          page: pageFor(url),
          counts: { all: 60, outbox: 60, reminders: 0, cleanup: 0 },
        });
      }),
    );

    const email = mount(<Email />);
    await settle();
    expect(requests.some((url) => url.pathname === "/api/v1/admin/stats")).toBe(false);
    void act(() => nextButton(email).click());
    await settle();
    expect(
      requests
        .filter((url) => url.pathname === "/api/v1/admin/email/outbox")
        .at(-1)
        ?.searchParams.get("offset"),
    ).toBe("50");
    const status = email.querySelector("select") as HTMLSelectElement;
    status.value = "failed";
    void act(() => {
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const apply = [...email.querySelectorAll("button")].find((button) => button.textContent === "Apply")!;
    void act(() => apply.click());
    await settle();
    const filteredEmailRequest = requests.filter((url) => url.pathname === "/api/v1/admin/email/outbox").at(-1)!;
    expect(filteredEmailRequest.searchParams.get("status")).toBe("failed");
    expect(filteredEmailRequest.searchParams.get("offset")).toBe("0");
    void act(() => render(null, email));

    const dueWork = mount(<DueWorkTable reminderLimit={50} outboxLimit={50} includeRetention={false} refreshKey={0} />);
    await settle();
    void act(() => nextButton(dueWork).click());
    await settle();
    expect(
      requests
        .filter((url) => url.pathname === "/api/v1/admin/due-work")
        .at(-1)
        ?.searchParams.get("offset"),
    ).toBe("25");
    const pageSize = dueWork.querySelector(".adm-pager-size") as HTMLSelectElement;
    pageSize.value = "50";
    void act(() => {
      pageSize.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const resizedDueWorkRequest = requests.filter((url) => url.pathname === "/api/v1/admin/due-work").at(-1)!;
    expect(resizedDueWorkRequest.searchParams.get("limit")).toBe("50");
    expect(resizedDueWorkRequest.searchParams.get("offset")).toBe("0");
    const outboxTab = [...dueWork.querySelectorAll("button")].find((button) => button.textContent?.includes("Outbox"))!;
    void act(() => outboxTab.click());
    await settle();
    const filteredDueWorkRequest = requests.filter((url) => url.pathname === "/api/v1/admin/due-work").at(-1)!;
    expect(filteredDueWorkRequest.searchParams.get("bucket")).toBe("outbox");
    expect(filteredDueWorkRequest.searchParams.get("offset")).toBe("0");
  });
});
