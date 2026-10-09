// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BadgeTemplateEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeTemplateEditor";
import { eventBadgeTemplateSchema } from "../../assets/shared/schemas/event-badge-template";
import {
  groupEventDetailResponseSchema,
  groupEventSettingsUpdateSchema,
} from "../../assets/shared/schemas/group-events";
import { exportBadgeTemplateHtml } from "../../assets/shared/badge-template-import";
import { BADGE_GENERIC_BRAND_ASSETS } from "../../assets/shared/badge-generic-template-assets";
import { clearAuth, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { controlFor } from "./helpers/labelled-control";

const GROUP = "10000000-0000-4000-8000-000000000001";
const ID = "10000000-0000-4000-8000-000000000002";
const ENDPOINT = `/api/v1/groups/${GROUP}/events/${ID}`;
const template = eventBadgeTemplateSchema.parse({
  version: 1,
  name: "Workshop design",
  widthMm: 105,
  heightMm: 148,
  frontHtml: "<div>{{displayName}}</div><div>{{qr}}</div>",
  backHtml: "<div>Workshop back</div>",
  css: "div{color:#111}",
  assets: {},
  sponsorGroups: [],
});
const resource = groupEventDetailResponseSchema.parse({
  event: {
    id: ID,
    ownerGroupId: GROUP,
    seriesId: null,
    slug: "workshop",
    basePath: null,
    name: "Workshop",
    timezone: "Europe/Amsterdam",
    startsAt: null,
    endsAt: null,
    profileKey: "workshop",
    sourceMode: "portal",
    registrationPolicy: "optional",
    visibility: "group_members",
    inviteLimitAttendee: 0,
    location: null,
    links: [],
    nextOccurrenceAt: null,
    updatedAt: "2030-01-01T10:00:00.000Z",
    proposalAccess: null,
    capabilities: ["manage"],
  },
});
let host: HTMLDivElement;
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount() {
  await act(async () =>
    render(<BadgeTemplateEditor slug="workshop" groupId={GROUP} eventId={ID} onBack={vi.fn()} />, host),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(host.querySelector("textarea")).not.toBeNull();
  });
}
beforeEach(() => {
  clearAuth();
  savePortalSession(portalSessionFixture({ member: true }));
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  clearAuth();
  vi.unstubAllGlobals();
});
it("imports ordinary HTML, saves through the owning event revision guard, and retains the draft after concurrent refusal", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      if (path.endsWith("/printing")) return json({ revision: "1".repeat(64), template, branding: [] });
      if (init?.method === "PATCH") {
        const body = groupEventSettingsUpdateSchema.parse(JSON.parse(String(init.body)));
        bodies.push(body);
        if (bodies.length === 1)
          return json({ ...resource, event: { ...resource.event, updatedAt: "2030-01-01T10:01:00.000Z" } });
        return json({ error: { code: "EVENT_CHANGED", message: "The event changed. Reload before saving." } }, 409);
      }
      expect(path).toBe(ENDPOINT);
      return json(resource);
    }),
  );
  await mount();
  const imported = { ...template, name: "New city design", backHtml: "<div>New city back</div>" };
  const file = new File([exportBadgeTemplateHtml(imported)], "new-city.html", { type: "text/html" });
  Object.defineProperty(file, "text", { value: async () => exportBadgeTemplateHtml(imported) });
  const upload = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(upload, "files", { value: [file] });
  await act(() => {
    upload.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(controlFor<HTMLTextAreaElement>(host, "Editable HTML").value).toContain("New city back");
  });
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(host.textContent).toContain("Badge design saved");
  });
  expect(bodies[0]).toMatchObject({
    expectedUpdatedAt: resource.event.updatedAt,
    badgeTemplate: { name: "New city design" },
  });
  expect(Object.keys(groupEventSettingsUpdateSchema.parse(bodies[0])).sort()).toEqual([
    "badgeTemplate",
    "expectedUpdatedAt",
  ]);
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(bodies).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  expect(groupEventSettingsUpdateSchema.parse(bodies[1]).expectedUpdatedAt).toBe("2030-01-01T10:01:00.000Z");
  expect(controlFor<HTMLTextAreaElement>(host, "Editable HTML").value).toContain("New city back");
});
it("refuses active HTML before a settings write and keeps the authored input visible", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) =>
    new URL(String(input), location.origin).pathname.endsWith("/printing")
      ? json({ revision: "1".repeat(64), template, branding: [] })
      : json(resource),
  );
  vi.stubGlobal("fetch", fetch);
  await mount();
  const field = controlFor<HTMLTextAreaElement>(host, "Editable HTML");
  await act(() => {
    field.value = exportBadgeTemplateHtml(template).replace("</body>", "<script>alert(1)</script></body>");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const count = fetch.mock.calls.length;
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(fetch.mock.calls).toHaveLength(count);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(field.value).toContain("<script>");
});
it("starts from the PQC conference preset with consortium sponsors, keeps two event tiers as optional groups, then saves it", async () => {
  const bodies: unknown[] = [];
  const fonts: string[] = [];
  const scheduled = {
    ...resource,
    event: {
      ...resource.event,
      name: "PQC Conference",
      startsAt: "2030-12-01T08:00:00.000Z",
      endsAt: "2030-12-03T17:00:00.000Z",
      location: "Amsterdam, Netherlands",
    },
  };
  const current = {
    ...template,
    sponsorGroups: [
      { key: "tier-a", tierName: "Leader" },
      { key: "tier-b", tierName: "Inspirator" },
      { key: "tier-c", tierName: "Innovator" },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      if (path.endsWith("/printing")) return json({ revision: "1".repeat(64), template: current, branding: [] });
      if (path.startsWith("/fonts/")) {
        fonts.push(path);
        return new Response(Buffer.from(BADGE_GENERIC_BRAND_ASSETS.roboto_latin.base64, "base64"));
      }
      if (init?.method === "PATCH") {
        bodies.push(groupEventSettingsUpdateSchema.parse(JSON.parse(String(init.body))));
        return json({ ...scheduled, event: { ...scheduled.event, updatedAt: "2030-01-01T10:01:00.000Z" } });
      }
      return json(scheduled);
    }),
  );
  await mount();
  const apply = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Start from PQC conference design",
  )!;
  await act(() => apply.click());
  await vi.waitFor(async () => {
    await settle();
    expect(controlFor<HTMLTextAreaElement>(host, "Editable HTML").value).toContain("pqc-badge");
  });
  const draft = controlFor<HTMLTextAreaElement>(host, "Editable HTML").value;
  expect(draft).toContain("PQC Conference");
  expect(draft).toContain(">Amsterdam<");
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(host.textContent).toContain("Badge design saved");
  });
  const saved = eventBadgeTemplateSchema.parse(groupEventSettingsUpdateSchema.parse(bodies[0]).badgeTemplate);
  expect(saved.name).toBe("PQC conference badge");
  expect(saved.sponsorGroups).toEqual([
    { key: "consortium-1", source: "consortium", tierName: "Diamond", label: "Diamond sponsor" },
    { key: "consortium-2", source: "consortium", tierName: "Titanium", label: "Titanium sponsors" },
    { key: "event-3", source: "event", tierName: "Leader", label: "Leader sponsors" },
    { key: "event-4", source: "event", tierName: "Inspirator", label: "Inspirator sponsors" },
  ]);
  expect(draft).toContain("&quot;source&quot;:&quot;consortium&quot;");
  expect(saved.frontHtml).toContain("{{qrImage}}");
  expect(saved.frontHtml).toContain("{{badgeCode}}");
  expect(fonts.sort()).toEqual(["/fonts/Roboto-latin-ext.woff2", "/fonts/Roboto-latin.woff2"]);
  expect(Object.values(saved.assets)).toContainEqual(BADGE_GENERIC_BRAND_ASSETS.roboto_latin);
});
