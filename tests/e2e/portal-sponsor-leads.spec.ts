/** UI-only synthetic lead transport. Native tests separately prove sponsor authorization and consent. */
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { eventAudienceDetailSchema, eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
  sponsorLeadCapturesSchema,
  sponsorLeadDetailSchema,
} from "../../assets/shared/schemas/event-sponsor-lead-list";
const slug = "pqc-conference-amsterdam-nl";
const sponsorId = "10000000-0000-4000-8000-000000000041";
const secondSponsorId = "10000000-0000-4000-8000-000000000043";
const leadId = "10000000-0000-4000-8000-000000000042";
const pageInfo = { limit: 50, offset: 0, total: 1, hasMore: false };
test.use({ actionTimeout: 20_000 });
test("sponsor live lead UI searches current contacts, shows capture provenance and clears offline", async ({
  page,
}, info) => {
  await signInAsE2eStaff(page, e2eAdminEmail("portal-sponsor-leads"));
  const event = eventDetailResponseSchema.parse(await (await page.request.get(`/api/v1/events/${slug}`)).json()).event;
  expect(event.name).toBeTruthy();
  await page.route(`**/api/v1/events/${slug}`, (route) =>
    route.fulfill({
      json: {
        event: eventAudienceDetailSchema.parse({
          ...event,
          accessLevel: "participant",
          links: [],
          basePath: null,
          viewer: null,
          sponsorLeadAccess: true,
        }),
      },
    }),
  );
  await page.route("**/api/v1/auth/session", async (route) => {
    const response = await route.fetch();
    const session = userAuthSessionResponseSchema.parse(await response.json());
    expect(session.staff).toBeDefined();
    session.staff!.grants.push({ permission: "agenda:leads_view", contextType: "event_sponsor", contextId: sponsorId });
    await route.fulfill({ response, json: session });
  });
  const requests: URL[] = [];
  let multipleSponsors = false;
  await page.route(`**/api/v1/events/${slug}/sponsors/**`, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const path = url.pathname;
    const payload = path.endsWith("/captures")
      ? sponsorLeadCapturesSchema.parse({
          captures: [
            {
              id: leadId,
              operatorName: "Demo operator",
              observedAt: "2026-12-01T09:30:00.000Z",
              receivedAt: "2026-12-01T09:32:00.000Z",
            },
          ],
          page: pageInfo,
        })
      : path.endsWith(`/sponsors/${sponsorId}/leads/${leadId}`)
        ? sponsorLeadDetailSchema.parse({
            lead: {
              id: leadId,
              name: "Synthetic attendee",
              email: "synthetic-lead@gmail.com",
              organization: null,
              personalEmail: true,
              capturedAt: "2026-12-01T09:30:00.000Z",
              operatorName: "Demo operator",
            },
            sponsorName: "Example sponsor",
          })
        : path.endsWith(`/sponsors/${secondSponsorId}/leads`)
          ? sponsorLeadListSchema.parse({ leads: [], page: { ...pageInfo, total: 0 } })
          : path.endsWith(`/sponsors/${sponsorId}/leads`)
            ? sponsorLeadListSchema.parse({
                leads: [
                  {
                    id: leadId,
                    name: "Synthetic attendee",
                    email: "synthetic-lead@gmail.com",
                    organization: null,
                    personalEmail: true,
                    capturedAt: "2026-12-01T09:30:00.000Z",
                    operatorName: "Demo operator",
                  },
                ],
                page: pageInfo,
              })
            : sponsorLeadSponsorsSchema.parse({
                sponsors: [
                  {
                    id: sponsorId,
                    name: "Example sponsor",
                    capturedCount: 1,
                    canView: true,
                    canCapture: false,
                    canExport: false,
                    canRemoveAll: true,
                  },
                  ...(multipleSponsors
                    ? [
                        {
                          id: secondSponsorId,
                          name: "Second sponsor",
                          capturedCount: 0,
                          canView: true,
                          canCapture: false,
                          canExport: false,
                          canRemoveAll: true,
                        },
                      ]
                    : []),
                ],
                page: { ...pageInfo, total: multipleSponsors ? 2 : 1 },
              });
    await route.fulfill({ json: payload, headers: { "cache-control": "private, no-store" } });
  });
  await page.goto(`/portal/#/events/${slug}/leads`);
  // Hash navigation can reuse the authenticated shell; reload to hydrate the synthetic contextual grant.
  await page.reload();
  await expect(page.locator(".pk-event-hero").getByRole("heading")).toHaveText(event.name);
  await expect(page.getByRole("navigation", { name: "Event", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open leads for Example sponsor" })).toHaveCount(0);
  const contacts = page.getByRole("region", { name: "Consenting leads", exact: true });
  await expect(contacts.getByText("Synthetic attendee", { exact: true })).toBeVisible();
  await expect(contacts.getByText("Personal email address", { exact: true })).toBeVisible();
  await contacts.getByRole("button", { name: "Actions for Synthetic attendee" }).click();
  await page.getByRole("menuitem", { name: "Remove lead for sponsor" }).click();
  await expect(page.getByRole("alertdialog", { name: "Remove Synthetic attendee for Example sponsor?" })).toBeVisible();
  await page
    .getByRole("alertdialog", { name: "Remove Synthetic attendee for Example sponsor?" })
    .getByRole("button", { name: "Cancel" })
    .click();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(
      page.getByRole("navigation", { name: device === "phone" ? "Event app" : "Event", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`sponsor-lead-organization-${device}.png`), fullPage: true });
  }
  multipleSponsors = true;
  await page.reload();
  const sponsorPicker = page.getByRole("combobox", { name: "Sponsor", exact: true });
  await expect(sponsorPicker).toBeVisible();
  await sponsorPicker.click();
  await page.getByRole("option", { name: "Second sponsor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Second sponsor", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Event app", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("sponsor-lead-switcher-phone.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("navigation", { name: "Event", exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath("sponsor-lead-switcher-desktop.png") });
  multipleSponsors = false;
  await page.reload();
  await page.getByRole("searchbox", { name: "Search consenting leads", exact: true }).fill("Synthetic");
  await page.getByRole("searchbox", { name: "Search consenting leads", exact: true }).press("Enter");
  await expect
    .poll(() =>
      requests.some(
        (url) => url.pathname.endsWith(`/sponsors/${sponsorId}/leads`) && url.searchParams.get("q") === "Synthetic",
      ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "View lead Synthetic attendee", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Capture history", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Scanned at/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Uploaded at/ })).toBeVisible();
  const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/sponsor-leads";
  await mkdir(artifacts, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/sponsor-live-leads-phone.png`, fullPage: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(page.getByText("Synthetic attendee", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reconnect to view current consenting contacts.", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/sponsor-live-leads-offline-phone.png`, fullPage: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.getByRole("heading", { name: "Synthetic attendee", exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Synthetic attendee", { exact: true })).toHaveCount(0);
});
