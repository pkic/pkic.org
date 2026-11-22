// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { ProductionPartnersSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/ProductionPartnersSettings";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { beginRecordEdit } from "./helpers/record-edit";

const CAMERA = "20000000-0000-4000-8000-000000000001";
const CAPTIONS = "20000000-0000-4000-8000-000000000002";
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
  productionPartners: [
    { role: "Camera Technology Provider", organizationId: CAMERA, name: "Northlight", website: null, logoUrl: null },
    { role: "Captioning", organizationId: CAPTIONS, name: "Clearline", website: null, logoUrl: null },
  ],
  settings: {},
});
let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
});

/** Signs in staff who may, or may not, read the organization list the picker searches. */
function signIn(readsOrganizations: boolean) {
  portalSession.value = portalSessionFixture({
    staff: true,
    grants: readsOrganizations ? [{ permission: "organizations:read", contextType: null, contextId: null }] : [],
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function open(sent: Array<{ method: string; url: string; body: unknown }> = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ url: String(input), method, body });
      if (String(input).startsWith("/api/v1/organizations"))
        return Response.json({ organizations: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      return Response.json({
        event:
          method === "PATCH"
            ? {
                ...event,
                updatedAt: "2026-08-30T00:00:00.000Z",
                productionPartners: event.productionPartners.filter((partner) =>
                  (body as { productionPartners: Array<{ organizationId: string }> }).productionPartners.some(
                    (kept) => kept.organizationId === partner.organizationId,
                  ),
                ),
              }
            : event,
      });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<ProductionPartnersSettings slug="summit" canEdit />, root));
  await vi.waitFor(async () => {
    await settle();
    expect(root.textContent).toContain("Camera Technology Provider");
  });
  return sent;
}

it("credits each partner with what it provides and saves a changed list through the settings contract", async () => {
  signIn(true);
  const sent = await open();
  // Read as a credit and a name; the name is the organization's, so it is never typed here.
  expect([...root.querySelectorAll("dt")].map((term) => term.textContent)).toEqual([
    "Camera Technology Provider",
    "Captioning",
  ]);
  expect([...root.querySelectorAll("dd")].map((value) => value.textContent)).toEqual(["Northlight", "Clearline"]);

  await beginRecordEdit(root, "Production partner actions", "Edit partners");
  const credit = root.querySelector<HTMLInputElement>('input[placeholder="Camera Technology Provider"]')!;
  expect(credit.value).toBe("Camera Technology Provider");
  await act(async () => {
    credit.value = "Camera Partner";
    credit.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => root.querySelector<HTMLButtonElement>('button[aria-label="Remove Clearline"]')!.click());
  await act(async () => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(sent.some((request) => request.method === "PATCH")).toBe(true);
  });
  const patch = sent.find((request) => request.method === "PATCH")!;
  expect(patch.url).toBe("/api/v1/events/summit/settings");
  expect(eventSettingsUpdateSchema.parse(patch.body).productionPartners).toEqual([
    { role: "Camera Partner", organizationId: CAMERA },
  ]);
});

it("does not send a partner without a credit or an organization", async () => {
  signIn(true);
  const sent = await open();
  await beginRecordEdit(root, "Production partner actions", "Edit partners");
  const add = [...root.querySelectorAll("button")].find((button) => button.textContent === "+ Add production partner")!;
  await act(async () => add.click());
  await act(async () => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(sent.some((request) => request.method === "PATCH")).toBe(false);
  expect(root.textContent).toContain("Say what this partner provides.");
  expect(root.textContent).toContain("Choose one from the list.");
});

it("shows the credits without an edit action to someone who cannot read the organization list", async () => {
  signIn(false);
  await open();
  expect(root.textContent).toContain("Northlight");
  expect(root.querySelector('[aria-label="Production partner actions"]')).toBeNull();
});
