// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  eventBadgePrintPopulationQuerySchema,
  eventBadgePrintPopulationResponseSchema,
} from "../../assets/shared/schemas/event-badge-printing";
import { badgePrintingResponseSchema } from "../../assets/shared/schemas/route-contracts-event-badges";
import {
  badgeLabelBatchRequestSchema,
  type BadgeLabelBatchRequest,
} from "../../assets/shared/schemas/event-badge-label-batches";
import { RegistrationBadgePrinting } from "../../assets/ts/components/event-badges/RegistrationBadgePrinting";
import {
  filteredBadgePrintScope,
  loadBadgePrintPopulation,
  type BadgePrintPopulationRow,
} from "../../assets/ts/components/event-badges/badge-print-population";
import { downloadBadgeArtifact } from "../../assets/ts/components/event-badges/badge-print-artifacts";
import QR from "qrcode";
import { BadgePrintLayoutEditor } from "../../assets/ts/components/event-badges/BadgePrintLayoutEditor";
import { controlFor } from "./helpers/labeled-control";
import { badgePrintSettingsSchema } from "../../assets/shared/schemas/badge-print-layout";
import { BadgePrintPreview } from "../../assets/ts/components/event-badges/BadgePrintPreview";
import { BADGE_GENERIC_FONT_LICENSE } from "../../assets/shared/badge-generic-font-license";
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
const printing = badgePrintingResponseSchema.parse({ revision: "0".repeat(64), template: null, branding: [] });
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

function batchResponse(body: BadgeLabelBatchRequest) {
  return {
    operationId: body.operationId,
    labels: body.registrationIds.map((id) => {
      const index = Number(id.slice(-12));
      return {
        id: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        registrationId: id,
        userId: row(index).user_id,
        credential: "ABCDEFGHJKLMNPQR",
        displayName: row(index).display_name,
        firstName: "Synthetic",
        lastName: `Attendee ${index}`,
        organization: null,
        jobTitle: null,
        badgeRole: "attendee",
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    }),
  };
}
async function mountPrinting(rows: BadgePrintPopulationRow[], isCurrent = () => true) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  await act(() =>
    render(
      <RegistrationBadgePrinting
        slug="workshop"
        eventId={eventId}
        scope={{ kind: "selected", rows }}
        isCurrent={isCurrent}
        onBack={vi.fn()}
      />,
      host,
    ),
  );
  return host;
}
it("resolves the complete filtered selection before requesting QR data together", async () => {
  let populationReads = 0,
    batchReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).includes("/population")) {
        populationReads++;
        const rows = populationReads === 1 ? Array.from({ length: 200 }, (_, index) => row(index + 1)) : [row(201)];
        return json(page(rows, 201, populationReads === 1 ? row(200).id : null));
      }
      expect(populationReads).toBe(2);
      batchReads++;
      const body = badgeLabelBatchRequestSchema.parse(JSON.parse(String(init.body)));
      expect(body.registrationIds).toHaveLength(201);
      return json(batchResponse(body));
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
        scope={filteredBadgePrintScope(endpoint, { status: "registered", attendance_type: "in_person" })}
        isCurrent={() => true}
        onBack={vi.fn()}
      />,
      host,
    ),
  );
  await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());
  expect(batchReads).toBe(1);
});
it.each([500, 1000, 1001])(
  "loads %i selected attendees in compact batches and renders HTML without a file download",
  async (count) => {
    const bodies: BadgeLabelBatchRequest[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(String(input)).toBe("/api/v1/events/workshop/badges/labels/batches");
      const body = badgeLabelBatchRequestSchema.parse(JSON.parse(String(init.body)));
      bodies.push(body);
      return json(batchResponse(body));
    });
    vi.stubGlobal("fetch", fetch);
    const host = await mountPrinting(Array.from({ length: count }, (_, index) => row(index + 1)));
    await vi.waitFor(() => expect(host.querySelector("iframe")?.srcdoc).toContain("badge-print-sheet"));
    expect(fetch).toHaveBeenCalledTimes(Math.ceil(count / 1000));
    expect(bodies.map((body) => body.registrationIds.length)).toEqual(count <= 1000 ? [count] : [1000, 1]);
    expect(host.querySelector("iframe")?.srcdoc.match(/class="badge-print-sheet"/g)).toHaveLength(count * 2);
    expect(host.textContent).not.toContain("requests completed");
    expect(downloadBadgeArtifact).not.toHaveBeenCalled();
    expect(confirmAction).not.toHaveBeenCalled();
  },
);
it("retries a lost batch response with the same operation and publishes no partial labels", async () => {
  const bodies: BadgeLabelBatchRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = badgeLabelBatchRequestSchema.parse(JSON.parse(String(init.body)));
      bodies.push(body);
      if (bodies.length === 1) throw new Error("Connection lost");
      return json(batchResponse(body));
    }),
  );
  const host = await mountPrinting([row(1), row(2)]);
  await vi.waitFor(() => expect(host.textContent).toContain("could not reach online services"));
  expect(host.querySelector("iframe")).toBeNull();
  await click(host, "Reload labels");
  await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});
it.each(["changed owner", "wrong operation", "duplicate badge", "expired"])(
  "refuses invalid bulk data: %s",
  async (failure) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const body = badgeLabelBatchRequestSchema.parse(JSON.parse(String(init.body)));
        const response = batchResponse(body);
        if (failure === "changed owner") response.labels[0].userId = row(3).user_id;
        if (failure === "wrong operation") response.operationId = crypto.randomUUID();
        if (failure === "duplicate badge") response.labels[1].id = response.labels[0].id;
        if (failure === "expired") response.labels[0].expiresAt = "2020-01-01T00:00:00.000Z";
        return json(response);
      }),
    );
    const host = await mountPrinting([row(1), row(2)]);
    await vi.waitFor(() => expect(host.textContent).toContain("selected badges changed"));
    expect(host.querySelector("iframe")).toBeNull();
  },
);

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

it.each(["session changed", "revoked", "profile changed"])(
  "checks the complete batch before release and refuses after %s",
  async (refusal) => {
    let allowed = true,
      calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        calls++;
        const body = badgeLabelBatchRequestSchema.parse(JSON.parse(String(init.body)));
        if (calls > 1 && refusal === "revoked")
          return json({ error: { code: "BADGE_BATCH_CHANGED", message: "Badge unavailable" } }, 409);
        const response = batchResponse(body);
        if (calls > 1) response.labels[0].firstName = "Changed";
        return json(response);
      }),
    );
    const host = await mountPrinting([row(1), row(2)], () => allowed);
    await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());
    if (refusal === "session changed") allowed = false;
    await click(host, "Download print files");
    await click(host, "Reusable HTML print file");
    await vi.waitFor(() => expect(host.querySelector("iframe")).toBeNull());
    expect(downloadBadgeArtifact).not.toHaveBeenCalled();
    expect(calls).toBe(refusal === "session changed" ? 1 : 2);
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
  expect(badgePrintHtml(badges, badgePrintPreset("brother_dk_1208"), printing, "name_qr")).toContain(
    "size:38mm 89.8mm",
  );
  expect(a4.match(/class="badge-print-sheet"/g)).toHaveLength(1);
  expect(a4).toContain('aria-label="Badge front"');
  expect(a4).toContain('aria-label="Badge back"');
  const slots = [...document.querySelectorAll<HTMLElement>(".badge-print-slot")];
  expect(slots).toHaveLength(2);
  expect(slots.every((slot) => !slot.hasAttribute("style"))).toBe(true);
  expect(document.querySelector("style")?.textContent).toContain(".badge-print-slot-0{left:");
  expect(document.querySelector("style")?.textContent).toContain(".badge-print-slot-1{left:");
  expect(a4).toContain("A &lt; B");
  const image = document.querySelector("img")!;
  const label = decodeURIComponent(image.getAttribute("src")!.split(",")[1]);
  expect(label).toContain(encodeURIComponent(badges[0].svg));
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
  await click(host, "Labels (SVG ZIP)");
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

it("includes explicitly selected pending and cancelled registrations without changing their status", async () => {
  const rows = [
    { ...row(801), status: "pending_email_confirmation" as const },
    { ...row(802), status: "cancelled" as const },
  ];
  const result = await loadBadgePrintPopulation({ kind: "selected", rows }, new AbortController().signal, () => {});
  expect(result).toEqual(rows);
  expect(result.map((item) => item.status)).toEqual(["pending_email_confirmation", "cancelled"]);
});
