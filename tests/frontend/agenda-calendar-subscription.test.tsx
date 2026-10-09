import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  agendaCalendarSettingsSchema,
  type AgendaCalendarCurrentSubscription,
} from "../../assets/shared/schemas/event-agenda-calendar";
import { calendarSubscriptionLink } from "../../assets/shared/calendar-subscription-links";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  push: {
    state: "unavailable" as string,
    busy: false,
    error: "",
    enable: vi.fn(),
    disable: vi.fn(),
    reminderMinutes: 15,
    setReminderMinutes: vi.fn(),
    reload: vi.fn(),
  },
}));
vi.mock("../../assets/ts/shared/api-client", () => ({
  getJson: mocks.get,
  postJson: mocks.post,
  putJson: mocks.put,
  deleteJson: mocks.remove,
}));
vi.mock("../../assets/ts/member-flows/portal/ui", () => ({ toast: mocks.toast }));
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: mocks.confirm }));
vi.mock("../../assets/ts/member-flows/portal/notifications/useEventPushNotifications", () => ({
  useEventPushNotifications: () => mocks.push,
}));
import { AgendaCalendarSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/participation/AgendaCalendarSettings";

const endpoint = "/api/v1/events/conference/calendar";
const feed = `https://pkic.org/api/v1/events/conference/calendar/subscriptions/${"a".repeat(64)}/calendar.ics`;
const subscription = { id: "11111111-1111-4111-8111-111111111111", url: feed, createdAt: "2026-10-03T10:00:00.000Z" };
const settings = { includeTentative: false, reminderEnabled: false, reminderMinutes: 10 };
const calendarName = "Conference 2026 – My agenda";
let host: HTMLDivElement;
let current: AgendaCalendarCurrentSubscription;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount() {
  await act(async () => render(<AgendaCalendarSettings slug="conference" eventName="Conference 2026" />, host));
  await settle();
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const tile = (label: string) =>
  [...host.querySelectorAll<HTMLElement>(".pk-calendar-tile")].find((item) =>
    item.querySelector(".pk-calendar-tile__label")?.textContent?.startsWith(label),
  )!;
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
const control = (name: string) => host.querySelector<HTMLInputElement & HTMLSelectElement>(`[name="${name}"]`)!;

beforeEach(() => {
  current = { active: false, subscription: null };
  mocks.get.mockImplementation(async (url: string) => (url.endsWith("/current") ? current : settings));
  mocks.put.mockImplementation(async (_url: string, body: unknown) => body);
  mocks.post.mockResolvedValue(subscription);
  mocks.remove.mockResolvedValue({ revoked: true });
  mocks.confirm.mockResolvedValue(true);
  Object.assign(mocks.push, { state: "unavailable", busy: false, error: "" });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Calendar and reminders", () => {
  it("offers calendar apps as direct links once a private link exists, with no back button", async () => {
    current = { active: true, subscription };
    await mount();
    expect(host.querySelector("h1, h2")?.textContent).toBe("Calendar and reminders");
    expect(host.textContent).not.toContain("Back to");
    const google = tile("Google Calendar") as HTMLAnchorElement;
    expect(google.href).toBe(calendarSubscriptionLink("google", feed, calendarName));
    expect(google.target).toBe("_blank");
    expect(google.rel).toBe("noopener noreferrer");
    expect((tile("Outlook.com") as HTMLAnchorElement).href).toBe(
      calendarSubscriptionLink("outlook-com", feed, calendarName),
    );
    expect((tile("Microsoft 365") as HTMLAnchorElement).href).toBe(
      calendarSubscriptionLink("microsoft-365", feed, calendarName),
    );
    const apple = tile("Apple Calendar") as HTMLAnchorElement;
    expect(apple.href).toBe(feed.replace("https:", "webcal:"));
    expect(apple.target).toBe("");
    expect(host.querySelector<HTMLInputElement>("details input[readonly]")!.value).toBe(feed);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("creates the link on the first tap and sends the tab it opened to the calendar app", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.fn(() => tab);
    vi.stubGlobal("open", open);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await mount();
    await click(tile("Google Calendar"));
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect(mocks.post).toHaveBeenCalledWith(`${endpoint}/subscriptions`, expect.anything(), expect.anything());
    expect(agendaCalendarSettingsSchema.parse(mocks.post.mock.calls[0][1])).toEqual(settings);
    expect(tab.location.href).toBe(calendarSubscriptionLink("google", feed, calendarName));
    expect((tile("Google Calendar") as HTMLAnchorElement).href).toBe(tab.location.href);
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });

  it("asks for a second tap when the browser blocks the new tab", async () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null),
    );
    await mount();
    await click(tile("Outlook.com"));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("Choose your calendar again"), "info");
    expect(tile("Outlook.com").tagName).toBe("A");
  });

  it("copies the private link for any other calendar app", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount();
    await click(tile("Copy link"));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(feed);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("Link copied"), "success");
  });

  it("resets and turns off the link only after confirmation", async () => {
    current = { active: true, subscription };
    await mount();
    mocks.confirm.mockResolvedValueOnce(false);
    await click(button("Reset link")!);
    expect(mocks.post).not.toHaveBeenCalled();
    const replacement = { ...subscription, url: feed.replace("a".repeat(64), "b".repeat(64)) };
    mocks.post.mockResolvedValue(replacement);
    await click(button("Reset link")!);
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: "Reset link" }));
    expect(host.querySelector<HTMLInputElement>("details input[readonly]")!.value).toBe(replacement.url);
    await click(button("Turn off calendar link")!);
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: "Turn off link" }));
    expect(mocks.remove).toHaveBeenCalledWith(`${endpoint}/subscriptions`, expect.anything());
    expect(host.querySelector("details input")).toBeNull();
    expect(tile("Google Calendar").tagName).toBe("BUTTON");
  });

  it("saves each reminder change as it is made through the settings contract", async () => {
    await mount();
    expect(control("reminderMinutes")).toBeNull();
    await click(control("reminderEnabled"));
    expect(control("reminderEnabled").getAttribute("role")).toBe("switch");
    expect(agendaCalendarSettingsSchema.parse(mocks.put.mock.calls[0][1])).toEqual({
      ...settings,
      reminderEnabled: true,
    });
    const minutes = control("reminderMinutes");
    expect([...minutes.options].map((option) => option.textContent)).toEqual([
      "5 minutes before",
      "10 minutes before",
      "15 minutes before",
      "30 minutes before",
      "1 hour before",
    ]);
    await choose(minutes, "30");
    expect(mocks.put).toHaveBeenLastCalledWith(
      `${endpoint}/settings`,
      { ...settings, reminderEnabled: true, reminderMinutes: 30 },
      expect.anything(),
    );
    await click(control("includeTentative"));
    expect(agendaCalendarSettingsSchema.parse(mocks.put.mock.lastCall![1])).toMatchObject({ includeTentative: true });
    expect(mocks.toast).toHaveBeenCalledWith("Saved.", "success");
  });

  it("omits browser notifications where they cannot work", async () => {
    for (const state of ["loading", "unsupported", "unavailable", "error"]) {
      mocks.push.state = state;
      await mount();
      expect(control("pushEnabled")).toBeNull();
      expect(host.textContent).not.toMatch(/not available|notifications/i);
      render(null, host);
    }
  });

  it("turns this device's notifications on with the shared reminder time", async () => {
    mocks.push.state = "off";
    await mount();
    await click(control("pushEnabled"));
    expect(mocks.push.enable).toHaveBeenCalledWith(10);
    mocks.push.state = "on";
    await mount();
    expect(control("pushEnabled").checked).toBe(true);
    const minutes = control("reminderMinutes");
    await choose(minutes, "60");
    expect(mocks.push.enable).toHaveBeenLastCalledWith(60);
    await click(control("pushEnabled"));
    expect(mocks.push.disable).toHaveBeenCalledOnce();
  });
});
