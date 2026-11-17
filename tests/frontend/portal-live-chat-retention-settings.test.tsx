// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { LiveChatRetentionSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/LiveChatRetentionSettings";
import { beginRecordEdit } from "./helpers/record-edit";

const event = eventDetailSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  slug: "summit",
  name: "Summit",
  timezone: "Europe/Amsterdam",
  startsAt: null,
  endsAt: null,
  profileKey: "conference",
  registrationPolicy: "public",
  visibility: "public",
  inviteLimitAttendee: 5,
  updatedAt: "2026-08-29T00:00:00.000Z",
  basePath: null,
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  city: null,
  country: null,
  sessionTypes: null,
  ownerGroupId: null,
  sourceMode: "portal",
  seriesId: null,
  links: [],
  registrationPath: null,
  capabilities: ["read", "write"],
  settings: {},
});
let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("keeps the chat a week by default and saves 90 days through the settings contract", async () => {
  const sent: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      sent.push({ url: String(input), method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({
        event:
          method === "PATCH"
            ? { ...event, updatedAt: "2026-08-30T00:00:00.000Z", settings: { liveChat: { keepDays: 90 } } }
            : event,
      });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<LiveChatRetentionSettings slug="summit" />, root));
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("1 week after each session");
  });

  await beginRecordEdit(root, "Live chat settings actions");
  const ninety = [...root.querySelectorAll<HTMLInputElement>("input[type=radio]")].find(
    (input) => input.value === "90",
  )!;
  await act(async () => {
    ninety.click();
  });
  await act(async () => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("90 days after each session");
  });
  const patch = sent.find((request) => request.method === "PATCH")!;
  expect(patch.url).toBe("/api/v1/events/summit/settings");
  expect(eventSettingsUpdateSchema.parse(patch.body).liveChat).toEqual({ keepDays: 90 });
});
