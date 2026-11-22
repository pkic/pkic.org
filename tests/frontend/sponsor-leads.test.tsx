import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SponsorLeads } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SponsorLeads";
import { SponsorLeadDetail } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SponsorLeadDetail";
import { formatDateTimeInZone } from "../../assets/shared/format-date";
const id = "10000000-0000-4000-8000-000000000001";
const page = { limit: 25, offset: 0, total: 1, hasMore: false };
const hosts: HTMLElement[] = [];
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
async function mount(canView: boolean, canCapture = false, canExport = false, canRemoveAll = canView) {
  const requests: string[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    requests.push(path);
    expect(init?.cache).toBe("no-store");
    return path.includes(`/sponsors/${id}/leads`)
      ? json({
          leads: [
            {
              id,
              name: "Private person",
              email: "private@example.test",
              organization: "Example",
              title: null,
              capturedAt: "2030-01-01T10:00:00.000Z",
              operatorName: "Operator",
            },
          ],
          page,
        })
      : json({
          sponsors: [{ id, name: "Sponsor", canView, canCapture, canExport, canRemoveAll }],
          page,
        });
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  await act(() => render(<SponsorLeads slug="event" timeZone="UTC" />, host));
  await vi.waitFor(async () => {
    await settle();
    expect(host.textContent).toContain("Sponsor");
    if (canView || canCapture) expect(host.textContent).toContain("Private person");
  });
  expect(host.querySelector('button[aria-label="Open leads for Sponsor"]')).toBeNull();
  return { host, requests, fetcher };
}
async function openSponsorActions(host: HTMLElement): Promise<void> {
  await act(() => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Sponsor actions"]')!.click();
  });
  await settle();
}
afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await act(() => render(null, host));
    host.remove();
  }
  vi.unstubAllGlobals();
  window.location.hash = "";
});
describe("Live sponsor leads", () => {
  it("uses the shared list controls without offering empty row actions to a view-only reader", async () => {
    const { host } = await mount(true, false, false, false);
    expect(host.querySelector('input[placeholder="Search contacts…"]')).not.toBeNull();
    expect(host.querySelector('button[title="Refresh consenting leads"]')).not.toBeNull();
    expect(host.querySelector(".pk-panel__header")).toBeNull();
    expect(host.querySelector('[aria-label="Actions for Private person"]')).toBeNull();
  });
  it("offers a sponsor choice only when the operator represents several sponsors", async () => {
    const secondId = "10000000-0000-4000-8000-000000000002";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const sponsors = [
          {
            id,
            name: "First sponsor",
            canView: false,
            canCapture: true,
            canExport: false,
            canRemoveAll: false,
          },
          {
            id: secondId,
            name: "Second sponsor",
            canView: true,
            canCapture: false,
            canExport: false,
            canRemoveAll: true,
          },
        ];
        return String(url).includes(`/sponsors/${secondId}/leads`)
          ? json({ leads: [], page: { ...page, total: 0 } })
          : json({ sponsors, page: { ...page, total: 2 } });
      }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    await act(() => render(<SponsorLeads slug="event" timeZone="UTC" />, host));
    const selector = await vi.waitFor(() => {
      const control = host.querySelector<HTMLInputElement>('input[role="combobox"]');
      expect(control).not.toBeNull();
      return control!;
    });
    await act(() => selector.click());
    const second = await vi.waitFor(() => {
      const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (item) => item.textContent === "Second sponsor",
      );
      expect(option).toBeDefined();
      return option!;
    });
    await act(() => second.click());
    await vi.waitFor(() => expect(host.textContent).toContain("Consenting leads"));
    expect(selector.value).toBe("Second sponsor");
    expect(window.location.hash).toContain(`leadSponsor=${secondId}`);
    await act(() => render(null, host));
    await act(() => render(<SponsorLeads slug="event" timeZone="UTC" />, host));
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLInputElement>('input[role="combobox"]')?.value).toBe("Second sponsor"),
    );
  });
  it("keeps a selected sponsor during a failed lookup and recovers without showing another sponsor", async () => {
    const thirdId = "10000000-0000-4000-8000-000000000003";
    window.location.hash = `#/events/event/leads?leadSponsor=${thirdId}`;
    let failLookup = true;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes(`sponsorId=${thirdId}`)) {
        if (failLookup) throw new Error("Sponsor lookup failed");
        return json({
          sponsors: [
            {
              id: thirdId,
              name: "Chosen sponsor",
              canView: true,
              canCapture: false,
              canExport: false,
              canRemoveAll: false,
            },
          ],
          page: { ...page, total: 1 },
        });
      }
      if (path.includes(`/sponsors/${thirdId}/leads`)) return json({ leads: [], page: { ...page, total: 0 } });
      return json({
        sponsors: [
          {
            id,
            name: "Other sponsor",
            canView: true,
            canCapture: true,
            canExport: false,
            canRemoveAll: false,
          },
          {
            id: "10000000-0000-4000-8000-000000000002",
            name: "Second sponsor",
            canView: true,
            canCapture: true,
            canExport: false,
            canRemoveAll: false,
          },
        ],
        page: { ...page, total: 3 },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    await act(() => render(<SponsorLeads slug="event" timeZone="UTC" />, host));
    await vi.waitFor(() => expect(host.textContent).toContain("We could not reach online services"));
    expect(host.querySelector('button[aria-label="Scan leads"]')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes(`/sponsors/${id}/leads`))).toBe(false);
    expect(window.location.hash).toContain(`leadSponsor=${thirdId}`);
    failLookup = false;
    await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLInputElement>('input[role="combobox"]')?.value).toBe("Chosen sponsor"),
    );
    expect(fetcher.mock.calls.some(([url]) => String(url).includes(`/sponsors/${thirdId}/leads`))).toBe(true);
    expect(host.textContent).not.toContain("Other sponsor");
  });
  it("shows an operator only their own scans and keeps export separate", async () => {
    const first = await mount(false, true);
    expect(first.requests.some((url) => url.includes(`/sponsors/${id}/leads`))).toBe(true);
    expect(first.host.textContent).toContain("My lead scans");
    expect(first.host.textContent).toContain("1 item");
    expect(first.host.textContent).not.toContain("saved lead");
    expect(first.host.querySelector('button[aria-label="Scan leads"]')).not.toBeNull();
    expect(first.host.querySelector('button[aria-label="Sponsor actions"]')).toBeNull();
    const second = await mount(false, false, true);
    expect(second.requests.some((url) => url.includes(`/sponsors/${id}/leads`))).toBe(false);
    await openSponsorActions(second.host);
    expect(second.host.querySelector('a[href$="leads.csv"]')?.textContent).toBe("Export consenting leads");
    expect(second.host.textContent).not.toContain("Close sponsor");
  });
  it("fetches current contacts without caching and clears them when offline", async () => {
    const { host, requests } = await mount(true);
    expect(host.textContent).toContain("Private person");
    expect(requests.find((url) => url.includes(`/sponsors/${id}/leads`))).toContain("limit=50");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(host.textContent).not.toContain("Private person");
    expect(host.textContent).toContain("Reconnect");
    vi.restoreAllMocks();
  });
  it("refreshes consent from the server and removes contacts without browser persistence", async () => {
    const stored = vi.spyOn(Storage.prototype, "setItem");
    const { host, fetcher } = await mount(true);
    expect(host.textContent).toContain("Private person");
    fetcher.mockImplementation(async (url) =>
      String(url).includes(`/sponsors/${id}/leads`)
        ? json({ leads: [], page: { ...page, total: 0 } })
        : json({
            sponsors: [
              {
                id,
                name: "Sponsor",
                canView: true,
                canCapture: false,
                canExport: false,
                canRemoveAll: true,
              },
            ],
            page,
          }),
    );
    const refresh = host.querySelector<HTMLButtonElement>('button[title="Refresh consenting leads"]')!;
    await act(() => refresh.click());
    await settle();
    expect(host.textContent).not.toContain("Private person");
    expect(host.textContent).toContain("No currently consenting leads");
    expect(stored).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("loads attributable capture history only on request and separates device time from receipt", async () => {
    const { host, requests, fetcher } = await mount(true);
    expect(requests.some((url) => url.includes("/captures"))).toBe(false);
    const lead = host.querySelector<HTMLAnchorElement>('a[aria-label="View lead Private person"]');
    expect(lead?.getAttribute("href")).toContain(`/leads/${id}/${id}`);
    fetcher.mockImplementation(async (url) =>
      json(
        String(url).includes("/captures")
          ? {
              captures: [
                {
                  id,
                  operatorName: "Second operator",
                  observedAt: "2030-01-01T09:00:00.000Z",
                  receivedAt: "2030-01-01T11:00:00.000Z",
                },
              ],
              page,
            }
          : {
              lead: {
                id,
                name: "Private person",
                email: "private@example.test",
                organization: "Example",
                title: null,
                capturedAt: "2030-01-01T10:00:00.000Z",
                operatorName: "Operator",
              },
              sponsorName: "Sponsor",
            },
      ),
    );
    const detailHost = document.createElement("div");
    document.body.append(detailHost);
    hosts.push(detailHost);
    await act(() => render(<SponsorLeadDetail slug="event" sponsorId={id} leadId={id} timeZone="UTC" />, detailHost));
    await vi.waitFor(() => expect(detailHost.textContent).toContain("Second operator"));
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain(`/leads/${id}/captures`);
    expect(detailHost.textContent).toContain("Scanned at");
    expect(detailHost.textContent).toContain("Uploaded at");
    const headings = [...detailHost.querySelectorAll("th")].map((cell) => cell.textContent?.trim());
    const cells = [...detailHost.querySelectorAll("tbody tr:first-child td")];
    expect(cells[headings.findIndex((heading) => heading?.startsWith("Scanned at"))]?.textContent).toContain(
      formatDateTimeInZone("2030-01-01T09:00:00.000Z", "UTC"),
    );
    expect(cells[headings.findIndex((heading) => heading?.startsWith("Uploaded at"))]?.textContent).toContain(
      formatDateTimeInZone("2030-01-01T11:00:00.000Z", "UTC"),
    );
  });
  it("removes contacts from the DOM when the live view is hidden", async () => {
    const { host } = await mount(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(host.textContent).not.toContain("Private person");
    vi.restoreAllMocks();
  });
});
