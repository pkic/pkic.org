import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ScannerManualEntry } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerManualEntry";

const host = document.createElement("div");
document.body.append(host);
const onBadge = vi.fn();
const user = {
  id: crypto.randomUUID(),
  email: "alex@example.test",
  first_name: "Alex",
  last_name: "Example",
  organization_name: "Synthetic organization",
};
const code = "ABCDEFGHJKLMNPQR";
function show(online: boolean) {
  return act(() =>
    render(
      <ScannerManualEntry
        focusRequested={false}
        onFocusHandled={() => {}}
        badgeId=""
        onBadge={onBadge}
        field={{}}
        lookup={{ slug: "synthetic", online, disabled: false }}
      />,
      host,
    ),
  );
}
function input(value: string) {
  return act(() => {
    const field = host.querySelector<HTMLInputElement>("input")!;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  await act(() => render(null, host));
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("uses bounded server autocomplete, then resolves only the selected attendee's badge", async () => {
  const fetch = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).endsWith("/badge")
            ? { badgeId: code }
            : { users: [user], page: { limit: 8, offset: 0, total: 1, hasMore: false } },
        ),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  await show(true);
  await input("Synthetic organization");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('[aria-label="Matching attendees"] button')).not.toBeNull();
  });
  expect(String(fetch.mock.calls[0]![0])).toContain("q=Synthetic+organization");
  expect(String(fetch.mock.calls[0]![0])).toContain("limit=8");
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Matching attendees"] button')!.click());
  await vi.waitFor(() => expect(onBadge).toHaveBeenLastCalledWith(code));
  expect(String(fetch.mock.calls[1]![0])).toContain(`/attendees/${user.id}/badge`);
  await input("JKLMNPQRABCDEFGH");
  expect(onBadge).toHaveBeenLastCalledWith("JKLMNPQRABCDEFGH");
});
it("disables identity search offline and cancels a pending badge selection on disconnect", async () => {
  let release!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/badge")
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Response.json({ users: [user], page: { limit: 8, offset: 0, total: 1, hasMore: false } }),
    ),
  );
  await show(true);
  await input("Alex");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('[aria-label="Matching attendees"] button')).not.toBeNull();
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Matching attendees"] button')!.click());
  await show(false);
  await act(async () => release(Response.json({ badgeId: code })));
  expect(onBadge).not.toHaveBeenCalledWith(code);
  expect(host.textContent).toContain("Offline: use a badge code");
  expect(host.querySelector("input")?.getAttribute("name")).toBe("badgeId");
});
