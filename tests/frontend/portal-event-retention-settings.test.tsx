// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { EventRetentionSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EventRetentionSettings";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
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
  portalSession.value = null;
  vi.unstubAllGlobals();
});

/** Signs in staff who hold exactly this permission on the event. */
function holds(permission: string) {
  portalSession.value = portalSessionFixture({
    staff: true,
    grants: [{ permission, contextType: "event", contextId: event.id }],
  });
}

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
  await act(async () => render(<EventRetentionSettings slug="summit" canEdit />, root));
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("1 week after each session");
  });

  await beginRecordEdit(root, "Live chat settings actions");
  expect(root.querySelector("fieldset legend")?.textContent).toContain("Keep the attendee chat after each session for");
  const ninety = [...root.querySelectorAll<HTMLInputElement>("input[type=radio]")].find(
    (input) => input.value === "90",
  )!;
  await act(async () => {
    ninety.click();
  });
  await act(async () => {
    root
      .querySelector('[aria-label="Live chat"] form')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("90 days after each session");
  });
  const patch = sent.find((request) => request.method === "PATCH")!;
  expect(patch.url).toBe("/api/v1/events/summit/settings");
  expect(eventSettingsUpdateSchema.parse(patch.body).liveChat).toEqual({ keepDays: 90 });
});

it("shows the choice without an edit action to those who cannot change the event's settings", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ event })),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<EventRetentionSettings slug="summit" canEdit={false} />, root));
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("1 week after each session");
  });
  expect(root.querySelector('[aria-label="Live chat settings actions"]')).toBeNull();
});

it("offers the chat download and erase to the event's organizers, not to a room operator", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ event })),
  );
  const archive = async (permission: string) => {
    holds(permission);
    root = document.createElement("div");
    document.body.append(root);
    await act(async () => render(<EventRetentionSettings slug="summit" canEdit={false} />, root));
    await vi.waitFor(async () => {
      await settle();
      expect(root.textContent).toContain("1 week after each session");
    });
    const actions = [...root.querySelectorAll("button")].map(
      (action) => action.getAttribute("aria-label") ?? action.textContent!.trim(),
    );
    render(null, root);
    root.remove();
    return actions;
  };
  expect(await archive("agenda:live_studio")).toEqual([]);
  expect(await archive("events:write")).toEqual(["Download chat (CSV)", "Erase chat…"]);
});

/** A fetch stub that keeps one event and moves its version forward on every save, as the server does. */
function eventServer() {
  let current = { ...event, userRetentionDays: 2 as number | null };
  let version = 0;
  const sent: Array<{ method: string; body: Record<string, unknown> | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      sent.push({ method, body });
      if (method === "PATCH") {
        if (body?.expectedUpdatedAt !== current.updatedAt)
          return Response.json({ error: { code: "CONFLICT", message: "The event changed." } }, { status: 409 });
        version += 1;
        current = {
          ...current,
          updatedAt: `2026-08-30T00:00:0${version}.000Z`,
          ...(body.userRetentionDays === undefined ? {} : { userRetentionDays: body.userRetentionDays as number }),
          ...(body.liveChat === undefined ? {} : { settings: { liveChat: body.liveChat } }),
        };
      }
      return Response.json({ event: current });
    }),
  );
  return sent;
}

async function typeDays(value: string) {
  const input = root.querySelector<HTMLInputElement>('input[name="userRetentionDays"]')!;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

/** Submits the form inside the panel with this name. */
async function submit(panel: string) {
  const form = root.querySelector(`[aria-label="${panel}"] form`)!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function mount() {
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<EventRetentionSettings slug="summit" canEdit />, root));
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("2 days after the event ends");
  });
}

it("saves the days registration data is kept through the settings contract", async () => {
  const sent = eventServer();
  await mount();
  await beginRecordEdit(root, "Registration data settings actions");
  expect((await typeDays("90")).value).toBe("90");
  await submit("Registration data");
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("90 days after the event ends");
  });
  const patch = sent.find((request) => request.method === "PATCH")!;
  expect(eventSettingsUpdateSchema.parse(patch.body).userRetentionDays).toBe(90);
});

it("refuses a blank or zero period without sending it", async () => {
  const sent = eventServer();
  await mount();
  await beginRecordEdit(root, "Registration data settings actions");
  for (const value of ["", "0"]) {
    const input = await typeDays(value);
    await submit("Registration data");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  }
  expect(sent.some((request) => request.method === "PATCH")).toBe(false);
});

it("saves the chat choice after a registration data save without a version conflict", async () => {
  const sent = eventServer();
  await mount();
  await beginRecordEdit(root, "Registration data settings actions");
  await typeDays("90");
  await submit("Registration data");
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("90 days after the event ends");
  });

  await beginRecordEdit(root, "Live chat settings actions");
  await act(async () => {
    [...root.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((input) => input.value === "90")!.click();
  });
  await submit("Live chat");
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("90 days after each session");
  });
  const patches = sent.filter((request) => request.method === "PATCH");
  expect(patches).toHaveLength(2);
  expect(patches[1]!.body!.expectedUpdatedAt).toBe("2026-08-30T00:00:01.000Z");
  expect(root.textContent).toContain("90 days after the event ends");
});
