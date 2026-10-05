import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SponsorLeads } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SponsorLeads";
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
async function mount(canView: boolean, canCapture = false, canExport = false) {
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
              userId: id,
              name: "Private person",
              email: "private@example.test",
              organization: "Example",
              capturedAt: "2030-01-01T10:00:00.000Z",
              operatorUserId: id,
              operatorName: "Operator",
            },
          ],
          page,
        })
      : json({ sponsors: [{ id, name: "Sponsor", canView, canCapture, canExport }], page });
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  await act(() => render(<SponsorLeads slug="event" timeZone="UTC" />, host));
  await settle();
  const open = host.querySelector<HTMLButtonElement>('button[aria-label="Open leads for Sponsor"]')!;
  expect(open).not.toBeNull();
  await act(() => open.click());
  await settle();
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
});
describe("Live sponsor leads", () => {
  it("does not request contacts for capture-only or export-only access", async () => {
    const first = await mount(false, true);
    expect(first.requests.some((url) => url.includes(`/sponsors/${id}/leads`))).toBe(false);
    expect(first.host.textContent).toContain("Scan leads");
    await openSponsorActions(first.host);
    expect(first.host.querySelector('a[href$="leads.csv"]')).toBeNull();
    const second = await mount(false, false, true);
    expect(second.requests.some((url) => url.includes(`/sponsors/${id}/leads`))).toBe(false);
    await openSponsorActions(second.host);
    expect(second.host.querySelector('a[href$="leads.csv"]')?.textContent).toBe("Export consenting leads");
    await act(() => {
      [...second.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent === "Close sponsor")!
        .click();
    });
    expect(second.host.querySelector('button[aria-label="Sponsor actions"]')).toBeNull();
    expect(second.host.querySelector('button[aria-label="Open leads for Sponsor"]')).not.toBeNull();
  });
  it("fetches current contacts without caching and clears them when offline", async () => {
    const { host, requests } = await mount(true);
    expect(host.textContent).toContain("Private person");
    expect(host.textContent).toContain("Operator");
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
        : json({ sponsors: [{ id, name: "Sponsor", canView: true, canCapture: false, canExport: false }], page }),
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
    fetcher.mockImplementation(async () =>
      json({
        captures: [
          {
            id,
            operatorUserId: id,
            operatorName: "Second operator",
            observedAt: "2030-01-01T09:00:00.000Z",
            receivedAt: "2030-01-01T11:00:00.000Z",
          },
        ],
        page,
      }),
    );
    const history = host.querySelector<HTMLButtonElement>(
      'button[aria-label="View capture history for Private person"]',
    )!;
    await act(() => history.click());
    await settle();
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain(`/leads/${id}/captures`);
    expect(host.textContent).toContain("Second operator");
    expect(host.textContent).toContain("Device time (unverified)");
    expect(host.textContent).toContain("Server receipt");
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
