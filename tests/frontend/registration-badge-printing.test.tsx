// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  eventBadgePrintPopulationQuerySchema,
  eventBadgePrintPopulationResponseSchema,
} from "../../assets/shared/schemas/event-badge-printing";
import {
  badgeIssueRequestSchema,
  badgePrintRequestSchema,
  badgeCredentialMetadataSchema,
  badgePrintingResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { RegistrationBadgePrinting } from "../../assets/ts/components/event-badges/RegistrationBadgePrinting";
import {
  filteredBadgePrintScope,
  loadBadgePrintPopulation,
  type BadgePrintPopulationRow,
} from "../../assets/ts/components/event-badges/badge-print-population";
import { downloadBadgeArtifact } from "../../assets/ts/components/event-badges/badge-print-artifacts";
import QR from "qrcode";
import { BadgePrintLayoutEditor } from "../../assets/ts/components/event-badges/BadgePrintLayoutEditor";
import { controlFor } from "./helpers/labelled-control";
import { badgePrintSettingsSchema } from "../../assets/shared/schemas/badge-print-layout";
import { BadgePrintPreview } from "../../assets/ts/components/event-badges/BadgePrintPreview";
import { BADGE_GENERIC_FONT_LICENSE } from "../../assets/shared/badge-generic-template-assets";
import { badgePrintHtml } from "../../assets/ts/components/event-badges/badge-print-artifacts";
import { badgePrintPreset } from "../../assets/shared/badge-print-layout";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";

vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn(
      async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37"><path d="M4 4h1v1H4z"/></svg>',
    ),
  },
}));
const archiveGate = vi.hoisted(() => ({ resolve: null as ((blob: Blob) => void) | null }));
vi.mock("../../assets/ts/components/event-badges/badge-svg-archive", () => ({
  badgeSvgArchive: vi.fn(
    () =>
      new Promise<Blob>((resolve) => {
        archiveGate.resolve = resolve;
      }),
  ),
}));
const eventId = "80000000-0000-4000-8000-000000000001";
vi.mock("../../assets/ts/components/event-badges/badge-print-artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/components/event-badges/badge-print-artifacts")>()),
  downloadBadgeArtifact: vi.fn(),
}));
const printing = badgePrintingResponseSchema.parse({ revision: "1".repeat(64), template: null, branding: [] });
const printDetails = {
  firstName: "Synthetic",
  lastName: "Attendee",
  organization: null,
  badgeRole: "attendee" as const,
  printingRevision: printing.revision,
};
const endpoint = "/api/v1/groups/example/events/workshop/registrations/badges/population";
const mounted: HTMLElement[] = [];

function row(index: number): BadgePrintPopulationRow {
  return {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    user_id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    display_name: `Synthetic attendee ${index}`,
    status: "registered",
  };
}
function page(rows: BadgePrintPopulationRow[], total: number, nextCursor: string | null) {
  return eventBadgePrintPopulationResponseSchema.parse({
    registrations: rows,
    page: { limit: 200, total, nextCursor },
  });
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function query(input: RequestInfo | URL) {
  const url = new URL(String(input), location.origin);
  return eventBadgePrintPopulationQuerySchema.parse(Object.fromEntries(url.searchParams));
}
async function click(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  expect(button).toBeDefined();
  await act(() => button!.click());
}
beforeEach(() => {
  vi.mocked(confirmAction).mockClear();
  vi.mocked(downloadBadgeArtifact).mockClear();
  vi.mocked(QR.toString).mockClear();
});
afterEach(() => {
  for (const host of mounted.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
  vi.unstubAllGlobals();
});

it("captures server filters independently of the loaded offset/sort and traverses beyond the old offset limit", async () => {
  const requests: ReturnType<typeof query>[] = [];
  const scope = filteredBadgePrintScope(endpoint, {
    q: "Synthetic",
    status: "registered",
    waitlisted: "true",
    offset: "10000",
    sort: "-created_at",
    limit: "20",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const parsed = query(input);
      requests.push(parsed);
      const after = parsed.cursor ? Number(parsed.cursor.slice(-12)) : 0;
      const end = Math.min(after + parsed.limit, 10_001);
      const rows = Array.from({ length: end - after }, (_, index) => row(after + index + 1));
      return json(page(rows, 10_001, end < 10_001 ? row(end).id : null));
    }),
  );
  const rows = await loadBadgePrintPopulation(scope, new AbortController().signal, vi.fn());
  expect(rows).toHaveLength(10_001);
  expect(rows.at(-1)).toEqual(row(10_001));
  expect(requests).toHaveLength(51);
  expect(
    requests.every(
      (request) => request.q === "Synthetic" && request.status === "registered" && request.waitlisted === "true",
    ),
  ).toBe(true);
  expect(requests[0]?.cursor).toBeUndefined();
  expect(requests.at(-1)?.cursor).toBe(row(10_000).id);
});

it.each(["count drift", "duplicate registration", "duplicate attendee", "repeated cursor", "incomplete tail"])(
  "refuses %s before any credential is created",
  async (failure) => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        query(input);
        calls++;
        if (calls === 1) return json(page([row(1)], 2, row(1).id));
        const second =
          failure === "duplicate registration"
            ? row(1)
            : failure === "duplicate attendee"
              ? { ...row(2), user_id: row(1).user_id }
              : row(2);
        return json(
          page(
            failure === "incomplete tail" ? [] : [second],
            failure === "count drift" ? 3 : 2,
            failure === "repeated cursor" ? row(1).id : null,
          ),
        );
      }),
    );
    await expect(
      loadBadgePrintPopulation(filteredBadgePrintScope(endpoint, {}), new AbortController().signal, vi.fn()),
    ).rejects.toThrow(/changed|Not all matching/);
    expect(calls).toBe(2);
    expect(confirmAction).not.toHaveBeenCalled();
  },
);

it("keeps the actual management refusal authoritative and never issues a badge", async () => {
  const fetch = vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Event management required" } }, 403));
  vi.stubGlobal("fetch", fetch);
  await expect(
    loadBadgePrintPopulation(filteredBadgePrintScope(endpoint, {}), new AbortController().signal, vi.fn()),
  ).rejects.toMatchObject({ status: 403 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("loads every filtered page before confirmation, retains successful badges on refusal and retries the same remaining operation", async () => {
  const bodies: ReturnType<typeof badgeIssueRequestSchema.parse>[] = [];
  let reads = 0;
  let refused = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const pathname = new URL(String(input), location.origin).pathname;
      if (pathname.endsWith("/printing")) return json(printing);
      if (pathname.endsWith("/print")) {
        const parsed = badgePrintRequestSchema.parse(JSON.parse(String(init.body)));
        expect(parsed.printingRevision).toBe(printing.revision);
        const id = pathname.split("/").at(-2)!;
        const index = Number(id.slice(-12));
        return json({
          ...printDetails,
          id,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37"><path d="M4 4h1v1H4z"/></svg>',
          displayName: row(index).display_name,
          expiresAt: "2026-12-01T00:00:00.000Z",
        });
      }
      if (init.method !== "POST" && !pathname.endsWith("/population")) {
        const id = pathname.split("/").at(-1)!;
        const index = Number(id.slice(-12));
        return json({
          id,
          eventId,
          userId: row(index).user_id,
          displayName: row(index).display_name,
          createdAt: "2026-10-07T00:00:00.000Z",
          expiresAt: "2026-12-01T00:00:00.000Z",
          revokedAt: null,
          status: "active",
          reprintAvailable: true,
        });
      }
      if (init.method !== "POST") {
        const parsed = query(input);
        reads++;
        const index = parsed.cursor ? Number(parsed.cursor.slice(-12)) + 1 : 1;
        return json(page([row(index)], 3, index < 3 ? row(index).id : null));
      }
      expect(reads).toBe(3);
      const body = badgeIssueRequestSchema.parse(JSON.parse(String(init.body)));
      expect(body.replaceBadgeId).toBeUndefined();
      bodies.push(body);
      const index = Number(body.userId.slice(-12));
      if (index === 2 && !refused) {
        refused = true;
        return json({ error: { code: "BADGE_PERMISSION_CHANGED", message: "Synthetic partial refusal" } }, 409);
      }
      return json({
        result: "issued",
        id: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        credential: ["ABCDEFGHJKLMNPQR", "23456789ABCDEFGH", "JKLMNPQR23456789"][index - 1],
        expiresAt: "2026-12-01T00:00:00.000Z",
        replacedBadgeId: null,
      });
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const scope = filteredBadgePrintScope(endpoint, { q: "Synthetic", status: "registered" });
  await act(() =>
    render(
      <RegistrationBadgePrinting
        slug="workshop"
        eventId={eventId}
        scope={scope}
        isCurrent={() => true}
        onBack={vi.fn()}
      />,
      host,
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("0 of 3 requests completed"));
  expect(bodies).toHaveLength(0);
  await click(host, "Create all matching badges");
  await vi.waitFor(() => expect(host.textContent).toContain("Synthetic partial refusal"));
  expect(host.textContent).toContain("1 of 3 requests completed");
  expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Synthetic attendee 1");
  await click(host, "Retry remaining requests");
  await vi.waitFor(() => expect(host.textContent).toContain("3 of 3 requests completed"));
  expect(bodies.map((body) => body.userId)).toEqual([row(1).user_id, row(2).user_id, row(2).user_id, row(3).user_id]);
  expect(bodies.at(1)!.operationId).toBe(bodies.at(2)!.operationId);
  expect(reads).toBe(3);
  expect(confirmAction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(confirmAction).mock.calls[0]?.[0]?.body).toContain("3 additional credentials");
  const preview = host.querySelector("iframe")?.getAttribute("srcdoc");
  for (let index = 1; index <= 3; index++) expect(preview).toContain(`Synthetic attendee ${index}`);
});

it("preserves explicit selected-page scope without loading other attendees", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    await loadBadgePrintPopulation({ kind: "selected", rows: [row(2)] }, new AbortController().signal, vi.fn()),
  ).toEqual([row(2)]);
  expect(fetch).not.toHaveBeenCalled();
});

it("stops a cancelled population read before publishing its metadata", async () => {
  const controller = new AbortController();
  const progress = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      controller.abort();
      return json(page([row(1)], 1, null));
    }),
  );
  await expect(
    loadBadgePrintPopulation(filteredBadgePrintScope(endpoint, {}), controller.signal, progress),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(progress).not.toHaveBeenCalled();
});

it.each(["session changed", "revoked"])(
  "recovers a lost completed response through stable print retries, withholds mixed CSV, and refuses release after %s",
  async (refusal) => {
    const badgeId = "60000000-0000-4000-8000-000000000002";
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="original-badge" d="M0 0h1v1H0z"/></svg>';
    const metadata = badgeCredentialMetadataSchema.parse({
      id: badgeId,
      eventId,
      userId: row(2).user_id,
      displayName: row(2).display_name,
      createdAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      revokedAt: null,
      status: "active",
      reprintAvailable: true,
    });
    const issueBodies: ReturnType<typeof badgeIssueRequestSchema.parse>[] = [];
    const printBodies: ReturnType<typeof badgePrintRequestSchema.parse>[] = [];
    let current = true;
    let revoked = false;
    let metadataReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = new URL(String(input), location.origin).pathname;
        if (path.endsWith("/printing")) return json(printing);
        const firstId = "60000000-0000-4000-8000-000000000001";
        if (path.endsWith(`${firstId}/print`)) {
          badgePrintRequestSchema.parse(JSON.parse(String(init.body)));
          return json({
            ...printDetails,
            id: firstId,
            svg,
            displayName: row(1).display_name,
            expiresAt: metadata.expiresAt,
          });
        }
        if (init.method !== "POST" && path.endsWith(firstId))
          return json({ ...metadata, id: firstId, userId: row(1).user_id, displayName: row(1).display_name });
        if (init.method !== "POST") {
          expect(path).toBe(`/api/v1/events/workshop/badges/${badgeId}`);
          metadataReads++;
          return json(revoked ? { ...metadata, status: "revoked", revokedAt: "2026-10-07T00:00:00.000Z" } : metadata);
        }
        if (path.endsWith("/print")) {
          expect(path).toBe(`/api/v1/events/workshop/badges/${badgeId}/print`);
          printBodies.push(badgePrintRequestSchema.parse(JSON.parse(String(init.body))));
          if (revoked)
            return json(
              { error: { code: "BADGE_PRINT_UNAVAILABLE", message: "Badge no longer available for printing." } },
              409,
            );
          if (printBodies.length === 1)
            return json(
              { error: { code: "TEMPORARY_UNAVAILABLE", message: "Synthetic print preparation interrupted" } },
              503,
            );
          return json({
            ...printDetails,
            id: badgeId,
            svg,
            displayName: metadata.displayName,
            expiresAt: metadata.expiresAt,
          });
        }
        expect(path).toBe("/api/v1/events/workshop/badges");
        const body = badgeIssueRequestSchema.parse(JSON.parse(String(init.body)));
        expect(body.replaceBadgeId).toBeUndefined();
        issueBodies.push(body);
        if (body.userId === row(1).user_id)
          return json({
            result: "issued",
            id: "60000000-0000-4000-8000-000000000001",
            credential: "ABCDEFGHJKLMNPQR",
            expiresAt: metadata.expiresAt,
            replacedBadgeId: null,
          });
        if (issueBodies.filter((request) => request.userId === row(2).user_id).length === 1)
          throw new TypeError("Committed response was lost");
        return json({
          result: "replayed",
          id: badgeId,
          credential: null,
          expiresAt: metadata.expiresAt,
          replacedBadgeId: null,
        });
      }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    await act(() =>
      render(
        <RegistrationBadgePrinting
          slug="workshop"
          eventId={eventId}
          scope={{ kind: "selected", rows: [row(1), row(2)] }}
          isCurrent={() => current}
          onBack={vi.fn()}
        />,
        host,
      ),
    );
    await vi.waitFor(() => expect(host.textContent).toContain("0 of 2 requests completed"));
    await click(host, "Create selected badges");
    await vi.waitFor(() => expect(host.textContent).toContain("1 of 2 requests completed"));
    await click(host, "Retry remaining requests");
    await vi.waitFor(() => expect(host.textContent).toContain("Synthetic print preparation interrupted"));
    expect(host.textContent).toContain("1 of 2 requests completed");
    await click(host, "Retry remaining requests");
    await vi.waitFor(() => expect(host.textContent).toContain("2 of 2 requests completed"));
    expect(issueBodies.map((body) => body.userId)).toEqual([row(1).user_id, row(2).user_id, row(2).user_id]);
    expect(new Set(issueBodies.slice(1).map((body) => body.operationId)).size).toBe(1);
    expect(printBodies).toHaveLength(2);
    expect(printBodies[0]).toEqual(printBodies[1]);
    expect(printBodies[0]?.operationId).not.toBe(issueBodies[1]?.operationId);
    expect(QR.toString).not.toHaveBeenCalled();
    expect(metadataReads).toBe(1);
    expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("original-badge");
    expect(host.textContent).toContain("recovered without replacing their credentials");
    await click(host, "Download print files");
    expect(host.textContent).not.toContain("Printing CSV with QR codes");
    current = refusal !== "session changed";
    revoked = refusal === "revoked";
    await click(host, "Reusable HTML print file");
    await vi.waitFor(() => expect(host.querySelector("iframe")).toBeNull());
    expect(host.textContent).toContain(
      refusal === "session changed" ? "Sign in again" : "no longer available for printing",
    );
    expect(downloadBadgeArtifact).not.toHaveBeenCalled();
    expect(metadataReads).toBe(1);
    expect(issueBodies).toHaveLength(3);
    expect(printBodies).toHaveLength(refusal === "revoked" ? 3 : 2);
  },
);

it("prints exact canonical front/back sheets and label stock without changing QR bytes", () => {
  const badges = [
    {
      ...printDetails,
      id: "reference",
      displayName: "A < B",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1h1"/></svg>',
    },
  ];
  const a4 = badgePrintHtml(badges, badgePrintPreset("a6_front_back_a4"), printing, "name_qr");
  const document = new DOMParser().parseFromString(a4, "text/html");
  expect(document.querySelectorAll("div[hidden] pre")).toHaveLength(1);
  expect(document.querySelector("div[hidden] pre")?.textContent).toBe(BADGE_GENERIC_FONT_LICENSE);
  expect(a4).toContain("size:297mm 210mm");
  expect(a4.match(/class="badge-print-sheet"/g)).toHaveLength(1);
  expect(a4).toContain('aria-label="Badge front"');
  expect(a4).toContain('aria-label="Badge back"');
  expect(a4).toContain("A &lt; B");
  expect(a4).toContain(encodeURIComponent(badges[0].svg));
  expect(badgePrintHtml(badges, badgePrintPreset("avery_5160"), printing, "name_qr")).toContain("size:215.9mm 279.4mm");
});
it("checks release authority after asynchronous SVG archive preparation", async () => {
  let authorized = true;
  const beforeRelease = vi.fn(async () => authorized);
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  await act(() =>
    render(
      <BadgePrintPreview
        badges={[
          { ...printDetails, id: "one", displayName: "One", svg: "<svg/>" },
          { ...printDetails, id: "two", displayName: "Two", svg: "<svg/>" },
        ]}
        printing={printing}
        beforeRelease={beforeRelease}
      />,
      host,
    ),
  );
  await click(host, "Download print files");
  await click(host, "QR codes (SVG ZIP)");
  expect(beforeRelease).not.toHaveBeenCalled();
  authorized = false;
  await act(async () => {
    archiveGate.resolve?.(new Blob(["archive"], { type: "application/zip" }));
    await Promise.resolve();
  });
  expect(beforeRelease).toHaveBeenCalledTimes(1);
  expect(downloadBadgeArtifact).not.toHaveBeenCalled();
});

it("refuses a custom layout that does not fit, then applies the corrected canonical dimensions", async () => {
  const onApply = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  await act(() =>
    render(
      <BadgePrintLayoutEditor
        layout={{ ...badgePrintPreset("a6"), design: "name_qr" }}
        template={null}
        onApply={onApply}
      />,
      host,
    ),
  );
  const width = controlFor<HTMLInputElement>(host, "Badge width (mm)");
  await act(() => {
    width.value = "1000";
    width.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(onApply).not.toHaveBeenCalled();
  expect(host.textContent).toContain("exceed the page width");
  await act(() => {
    width.value = "100";
    width.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(badgePrintSettingsSchema.parse(onApply.mock.calls[0]?.[0]).label.widthMm).toBe(100);
});
