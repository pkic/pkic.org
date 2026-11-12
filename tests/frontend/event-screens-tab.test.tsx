// @vitest-environment jsdom
/**
 * The event workspace's Screens tab: who sees it and its commands, and what
 * pairing, editing, replacing a device, revoking and removing send and do
 * with the server's answer, and which cards read as inactive. List
 * mechanics (search, sort, paging) are the shared table's own tests.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScreenLiveStatus } from "../../assets/shared/schemas/event-screen-monitor";
import {
  eventScreenPairingCreateSchema,
  screenDeviceReplacementSchema,
  screenUpdateSchema,
  type ScreenRecord,
} from "../../assets/shared/schemas/event-screens";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { EventScreens } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/EventScreens";
import { screenInactive } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/ScreenMonitorCard";
import { visibleEventWorkspaceTabs } from "../../assets/ts/member-flows/portal/sections/management/group-event-workspace-tabs";
import { authStatus, portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { confirmationButton } from "./helpers/confirm-dialog";
import { groupEventWorkspaceFixture, EVENT_ID } from "./helpers/group-event-workspace-fixture";
import { controlFor, typeInto } from "./helpers/labeled-control";
import { rowMenuTrigger } from "./helpers/row-actions";

const SLUG = "pqc-conference-2026";
const ROOM_ID = "30000000-0000-4000-8000-000000000001";

const record = (overrides: Partial<ScreenRecord> = {}): ScreenRecord => ({
  id: "K7M2QA",
  name: "Foyer, by registration",
  eventId: "20000000-0000-4000-8000-000000000001",
  assignment: {
    roomId: ROOM_ID,
    roomName: "Blue room",
    output: "projector",
    layout: null,
    assignedAt: "2026-12-01T08:00:00.000Z",
  },
  revision: 3,
  session: {
    state: "active",
    activatedAt: "2026-12-01T08:00:00.000Z",
    lastSeenAt: "2026-12-01T09:25:00.000Z",
    expiresAt: "2027-12-01T08:00:00.000Z",
  },
  createdAt: "2026-11-30T08:00:00.000Z",
  ...overrides,
});

type Captured = { method: string; pathname: string; body: unknown };
type Reply = (request: Captured) => Response | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (status: number, code: string, details?: unknown) =>
  json({ error: { code, message: "Refused", ...(details ? { details } : {}) } }, status);

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  portalSession.value = null;
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Serves the list from `screens()` and every other request from `reply`, capturing each. */
function api(screens: () => ScreenRecord[], reply: Reply = () => undefined): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const request = {
        method: init?.method ?? "GET",
        pathname: url.pathname,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      requests.push(request);
      const answer = reply(request);
      if (answer) return answer;
      if (request.method === "GET" && url.pathname === `/api/v1/events/${SLUG}/screens`) {
        const rows = screens();
        return json({ screens: rows, page: { limit: 25, offset: 0, total: rows.length, hasMore: false } });
      }
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    }),
  );
  return requests;
}

async function mount(canManage: boolean): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <EventScreens slug={SLUG} canManage={canManage} now={Date.parse("2026-12-01T09:27:00.000Z")} />
      </>,
      container!,
    ),
  );
  await settle();
  return container;
}

const openDialog = () => document.querySelector<HTMLDialogElement>("dialog[open]");
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
const listReads = (requests: Captured[]) =>
  requests.filter((request) => request.method === "GET" && request.pathname.endsWith("/screens")).length;

async function rowMenuItem(root: HTMLElement, subject: string, label: string): Promise<HTMLButtonElement> {
  await act(() => rowMenuTrigger(root, subject)!.click());
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (entry) => entry.textContent?.trim() === label,
  )!;
}

async function rowCommand(root: HTMLElement, subject: string, label: string): Promise<void> {
  const item = await rowMenuItem(root, subject, label);
  await act(() => item.click());
  await settle();
}

describe("Screens tab visibility", () => {
  function grant(...permissions: string[]) {
    portalSession.value = portalSessionFixture({
      staff: true,
      administrator: false,
      grants: permissions.map((permission) => ({ permission, contextType: "event", contextId: EVENT_ID })),
    });
    authStatus.value = "authenticated";
  }
  const hasTab = () => visibleEventWorkspaceTabs(groupEventWorkspaceFixture()).some((tab) => tab.key === "screens");

  it("shows the tab to staff who manage screens or operate the rooms, and to no one else", () => {
    grant("agenda:screens_manage");
    expect(hasTab()).toBe(true);
    grant("agenda:live_moderate");
    expect(hasTab()).toBe(true);
    grant("agenda:read");
    expect(hasTab()).toBe(false);
  });

  it("offers pairing and row commands only to staff who manage screens", async () => {
    api(() => [record()]);
    const readOnly = await mount(false);
    expect(readOnly.textContent).toContain("Foyer, by registration");
    expect(button(readOnly, "Pair screen")).toBeUndefined();
    expect(rowMenuTrigger(readOnly, "Foyer, by registration")).toBeNull();
    await act(() => render(null, readOnly));
    readOnly.remove();

    const managing = await mount(true);
    expect(button(managing, "Pair screen")).toBeDefined();
    expect(rowMenuTrigger(managing, "Foyer, by registration")).not.toBeNull();
  });
});

describe("Pairing a screen", () => {
  async function fillAndPair(root: HTMLElement) {
    await act(() => button(root, "Pair screen")!.click());
    const dialog = openDialog()!;
    await typeInto(controlFor(dialog, "Pairing code"), "hjkp 4qrt");
    await typeInto(controlFor(dialog, "Screen ID"), "k7m2qa");
    await typeInto(controlFor(dialog, "Name"), "Foyer, by registration");
    await act(() => button(dialog, "Pair screen")!.click());
    await settle();
    return dialog;
  }

  it("sends the approval on the shared contract and reloads the list", async () => {
    const screens: ScreenRecord[] = [];
    const requests = api(
      () => screens,
      (request) => {
        if (request.method !== "POST") return undefined;
        screens.push(record({ session: { ...record().session, state: "pending" } }));
        return json(screens[0], 201);
      },
    );
    const root = await mount(true);
    await fillAndPair(root);

    const sent = requests.find((request) => request.method === "POST");
    expect(sent?.pathname).toBe(`/api/v1/events/${SLUG}/screens`);
    expect(eventScreenPairingCreateSchema.parse(sent!.body)).toMatchObject({
      screenId: "K7M2QA",
      pairingCode: "HJKP4QRT",
    });
    expect(openDialog()).toBeNull();
    expect(listReads(requests)).toBe(2);
    expect(root.textContent).toContain("Foyer, by registration");
  });

  it("keeps the dialog open and marks the field the server refused", async () => {
    api(
      () => [],
      (request) =>
        request.method === "POST"
          ? refusal(400, "VALIDATION_ERROR", { fieldErrors: { pairingCode: ["Enter the code shown now."] } })
          : undefined,
    );
    const root = await mount(true);
    const dialog = await fillAndPair(root);

    expect(openDialog()).toBe(dialog);
    expect(controlFor(dialog, "Pairing code").getAttribute("aria-invalid")).toBe("true");
  });

  it("offers to replace a signed-in screen with the same ID, and sends it only once confirmed", async () => {
    const posts: unknown[] = [];
    api(
      () => [],
      (request) => {
        if (request.method !== "POST") return undefined;
        posts.push(request.body);
        return posts.length === 1
          ? refusal(409, "SCREEN_ID_IN_USE", {
              fieldErrors: { screenId: ["“Foyer” has this screen ID and is signed in. Check the ID, or replace it."] },
            })
          : json(record(), 201);
      },
    );
    const root = await mount(true);
    const dialog = await fillAndPair(root);
    expect(controlFor(dialog, "Screen ID").getAttribute("aria-invalid")).toBe("true");
    const replace = [...dialog.querySelectorAll("label")]
      .find((label) => label.textContent?.startsWith("Replace the signed-in screen"))!
      .querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(replace.checked).toBe(false);
    expect(eventScreenPairingCreateSchema.parse(posts[0]).replace).toBeUndefined();

    await act(() => replace.click());
    await act(() => button(dialog, "Pair screen")!.click());
    await settle();
    expect(eventScreenPairingCreateSchema.parse(posts[1]).replace).toBe(true);
    expect(openDialog()).toBeNull();
  });
});

describe("Editing a screen", () => {
  it("reads the screen again after a revision conflict and saves from the new revision", async () => {
    let latest = record();
    let attempts = 0;
    const requests = api(
      () => [latest],
      (request) => {
        if (request.method === "GET" && request.pathname === "/api/v1/screens/K7M2QA")
          return json({ viewer: "staff", screen: latest });
        if (request.method !== "PATCH") return undefined;
        attempts += 1;
        if (attempts === 1) {
          latest = record({ name: "Foyer, by the stairs", revision: 4 });
          return refusal(409, "SCREEN_REVISION_CONFLICT");
        }
        latest = record({ name: "Foyer, main entrance", revision: 5 });
        return json(latest);
      },
    );
    const root = await mount(true);
    await rowCommand(root, "Foyer, by registration", "Edit");
    const dialog = openDialog()!;
    await typeInto(controlFor(dialog, "Name"), "Foyer, east door");
    await act(() => button(dialog, "Save screen")!.click());
    await settle();

    expect(openDialog()).toBe(dialog);
    expect(dialog.querySelector('[role="alert"], [role="status"]')).not.toBeNull();
    expect(controlFor(dialog, "Name").value).toBe("Foyer, by the stairs");
    expect(listReads(requests)).toBe(2);

    await typeInto(controlFor(dialog, "Name"), "Foyer, main entrance");
    await act(() => button(dialog, "Save screen")!.click());
    await settle();
    const patches = requests.filter((request) => request.method === "PATCH");
    expect(screenUpdateSchema.parse(patches[1]!.body).expectedRevision).toBe(4);
    expect(openDialog()).toBeNull();
  });
});

describe("Revoking a screen", () => {
  it("signs the screen out only once the confirmation is accepted", async () => {
    const requests = api(
      () => [record()],
      (request) => (request.method === "DELETE" ? new Response(null, { status: 204 }) : undefined),
    );
    const root = await mount(true);
    const deletes = () => requests.filter((request) => request.method === "DELETE");

    await rowCommand(root, "Foyer, by registration", "Revoke");
    await act(() => confirmationButton("Cancel")!.click());
    await settle();
    expect(deletes()).toHaveLength(0);

    await rowCommand(root, "Foyer, by registration", "Revoke");
    await act(() => confirmationButton("Revoke screen")!.click());
    await settle();
    expect(deletes().map((request) => request.pathname)).toEqual(["/api/v1/screens/K7M2QA/session"]);
    expect(listReads(requests)).toBe(2);
  });
});

describe("Replacing a screen's device", () => {
  async function fillAndReplace(root: HTMLElement) {
    await rowCommand(root, "Foyer, by registration", "Replace device…");
    const dialog = openDialog()!;
    await typeInto(controlFor(dialog, "Pairing code"), "hjkp-4qrt");
    await typeInto(controlFor(dialog, "Screen ID"), "n3wd7v");
    await act(() => button(dialog, "Replace device")!.click());
    await settle();
    return dialog;
  }

  it("sends the new device's code and ID from the screen's revision, and reloads the list", async () => {
    let screens = [record()];
    const requests = api(
      () => screens,
      (request) => {
        if (request.method !== "PUT") return undefined;
        screens = [record({ id: "N3WD7V", revision: 4, session: { ...record().session, state: "pending" } })];
        return json(screens[0]);
      },
    );
    const root = await mount(true);
    await fillAndReplace(root);

    const sent = requests.find((request) => request.method === "PUT");
    expect(sent?.pathname).toBe("/api/v1/screens/K7M2QA/device");
    expect(screenDeviceReplacementSchema.parse(sent!.body)).toEqual({
      expectedRevision: 3,
      newScreenId: "N3WD7V",
      pairingCode: "HJKP4QRT",
    });
    expect(openDialog()).toBeNull();
    expect(listReads(requests)).toBe(2);
    await settle();
    expect(root.textContent).toContain("N3WD7V");
  });

  it("reads the screen again after a revision conflict and replaces from the new revision", async () => {
    let latest = record();
    let attempts = 0;
    const requests = api(
      () => [latest],
      (request) => {
        if (request.method === "GET" && request.pathname === "/api/v1/screens/K7M2QA")
          return json({ viewer: "staff", screen: latest });
        if (request.method !== "PUT") return undefined;
        attempts += 1;
        if (attempts === 1) {
          latest = record({ name: "Foyer, by the stairs", revision: 4 });
          return refusal(409, "SCREEN_REVISION_CONFLICT");
        }
        return json(record({ id: "N3WD7V", name: "Foyer, by the stairs", revision: 5 }));
      },
    );
    const root = await mount(true);
    const dialog = await fillAndReplace(root);
    expect(openDialog()).toBe(dialog);
    expect(dialog.textContent).toContain("Foyer, by the stairs");

    await act(() => button(dialog, "Replace device")!.click());
    await settle();
    const puts = requests.filter((request) => request.method === "PUT");
    expect(puts.map((request) => screenDeviceReplacementSchema.parse(request.body).expectedRevision)).toEqual([3, 4]);
    expect(openDialog()).toBeNull();
  });

  it("keeps the dialog open on the screen ID another screen has", async () => {
    api(
      () => [record()],
      (request) =>
        request.method === "PUT"
          ? refusal(409, "SCREEN_ID_TAKEN", { fieldErrors: { newScreenId: ["“Spare” has this screen ID."] } })
          : undefined,
    );
    const root = await mount(true);
    const dialog = await fillAndReplace(root);
    expect(openDialog()).toBe(dialog);
    expect(controlFor(dialog, "Screen ID").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("Removing a screen", () => {
  it("offers removal once the screen is not signed in, and deletes it only once confirmed", async () => {
    let screens = [record()];
    const requests = api(
      () => screens,
      (request) => {
        if (request.method !== "DELETE") return undefined;
        screens = [];
        return new Response(null, { status: 204 });
      },
    );
    const signedIn = await mount(true);
    expect((await rowMenuItem(signedIn, "Foyer, by registration", "Remove")).disabled).toBe(true);
    await act(() => render(null, signedIn));
    signedIn.remove();

    screens = [record({ session: { state: "none", activatedAt: null, lastSeenAt: null, expiresAt: null } })];
    const root = await mount(true);
    await rowCommand(root, "Foyer, by registration", "Remove");
    await act(() => confirmationButton("Cancel")!.click());
    await settle();
    expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(0);

    await rowCommand(root, "Foyer, by registration", "Remove");
    await act(() => confirmationButton("Remove screen")!.click());
    await settle();
    expect(requests.filter((request) => request.method === "DELETE").map((request) => request.pathname)).toEqual([
      "/api/v1/screens/K7M2QA",
    ]);
    await settle();
    expect(rowMenuTrigger(root, "Foyer, by registration")).toBeNull();
  });
});

describe("Inactive screen cards", () => {
  const NOW = Date.parse("2026-12-01T09:27:00.000Z");
  const status = (online: boolean): ScreenLiveStatus => ({
    screenId: "K7M2QA",
    online,
    connectedAt: "2026-12-01T08:00:00.000Z",
    disconnectedAt: online ? null : "2026-12-01T09:10:00.000Z",
    reportedAt: "2026-12-01T09:10:00.000Z",
    stateSince: "2026-12-01T08:00:00.000Z",
    health: null,
  });

  it("marks a screen that shows nothing now, and never one whose state is unknown", () => {
    const pending = record({ session: { ...record().session, state: "pending", activatedAt: null } });
    const offline = record({ session: { ...record().session, lastSeenAt: "2026-12-01T09:10:00.000Z" } });
    expect(screenInactive(record(), status(true), NOW, null)).toBe(false);
    expect(screenInactive(record(), status(false), NOW, null)).toBe(true);
    expect(screenInactive(offline, undefined, NOW, null)).toBe(true);
    expect(screenInactive(pending, undefined, NOW, null)).toBe(false);
    expect(screenInactive(record(), status(false), NOW, NOW - 60_000)).toBe(false);
  });
});
