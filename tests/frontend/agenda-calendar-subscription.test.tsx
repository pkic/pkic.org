import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => ({
  getJson: mocks.get,
  postJson: mocks.post,
  putJson: mocks.put,
  deleteJson: mocks.remove,
}));
import { CalendarSubscription } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/CalendarSubscription";
let host: HTMLDivElement;
beforeEach(async () => {
  mocks.get.mockResolvedValue({ includeTentative: false, reminderEnabled: false, reminderMinutes: 10 });
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => render(<CalendarSubscription slug="conference" />, host));
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.clearAllMocks();
});
function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)!;
}
describe("Private calendar and explicit reminder preferences", () => {
  it("creates a private URL without persisting its bearer token in browser storage", async () => {
    const url = `https://pkic.org/api/v1/events/conference/calendar/subscriptions/${"a".repeat(64)}/calendar.ics`;
    mocks.post.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      url,
      createdAt: "2026-10-03T10:00:00.000Z",
    });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => button("Create or replace calendar URL").click());
    expect(mocks.post).toHaveBeenCalledWith(
      "/api/v1/events/conference/calendar/subscriptions",
      { includeTentative: false, reminderEnabled: false, reminderMinutes: 10 },
      expect.anything(),
    );
    expect(host.querySelector("a")?.getAttribute("rel")).toBe("noreferrer");
    const calendarUrl = host.querySelector<HTMLInputElement>("input[readonly]")!;
    expect(calendarUrl.value).toBe(url);
    expect(calendarUrl.readOnly).toBe(true);
    expect(host.textContent).toContain("Previous URLs have been revoked");
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it("requires explicit reminder opt-in and refuses a zero-minute lead time through the shared contract", async () => {
    const checkbox = host.querySelector<HTMLInputElement>('[name="reminderEnabled"]')!;
    await act(async () => checkbox.click());
    const minutes = host.querySelector<HTMLInputElement>('[name="reminderMinutes"]')!;
    await act(async () => {
      minutes.value = "0";
      minutes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.put).not.toHaveBeenCalled();
    await act(async () => {
      minutes.value = "20";
      minutes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.put.mockResolvedValue({ includeTentative: false, reminderEnabled: true, reminderMinutes: 20 });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.put).toHaveBeenCalledWith(
      "/api/v1/events/conference/calendar/settings",
      { includeTentative: false, reminderEnabled: true, reminderMinutes: 20 },
      expect.anything(),
    );
  });
  it("revokes all owned URLs and explains removing the old calendar subscription", async () => {
    mocks.remove.mockResolvedValue({ revoked: true });
    await act(async () => button("Revoke calendar URLs").click());
    expect(mocks.remove).toHaveBeenCalledWith("/api/v1/events/conference/calendar/subscriptions", expect.anything());
    expect(host.textContent).toContain("Remove the old subscription");
  });
});
