/** UI-only synthetic lead transport. Native tests separately prove sponsor authorization and consent. */
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
  sponsorLeadCapturesSchema,
} from "../../assets/shared/schemas/event-sponsor-lead-list";
const slug = "pqc-conference-amsterdam-nl";
const sponsorId = "10000000-0000-4000-8000-000000000041";
const leadId = "10000000-0000-4000-8000-000000000042";
const operatorId = "10000000-0000-4000-8000-000000000043";
const pageInfo = { limit: 50, offset: 0, total: 1, hasMore: false };
test.use({ actionTimeout: 20_000 });
test("sponsor live lead UI searches current contacts, shows capture provenance and clears offline", async ({
  page,
}) => {
  await signInAsE2eStaff(page, e2eAdminEmail("portal-sponsor-leads"));
  const event = eventDetailResponseSchema.parse(await (await page.request.get(`/api/v1/events/${slug}`)).json()).event;
  const ownerGroupId = "ownerGroupId" in event ? event.ownerGroupId : null;
  expect(ownerGroupId, "Seeded event must have its group workspace").toBeTruthy();
  await page.route("**/api/v1/auth/session", async (route) => {
    const response = await route.fetch();
    const session = userAuthSessionResponseSchema.parse(await response.json());
    expect(session.staff).toBeDefined();
    session.staff!.grants.push({ permission: "agenda:leads_view", contextType: "event_sponsor", contextId: sponsorId });
    await route.fulfill({ response, json: session });
  });
  const requests: URL[] = [];
  await page.route(`**/api/v1/events/${slug}/sponsors/**`, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const path = url.pathname;
    const payload = path.endsWith("/captures")
      ? sponsorLeadCapturesSchema.parse({
          captures: [
            {
              id: leadId,
              operatorUserId: operatorId,
              operatorName: "Demo operator",
              observedAt: "2026-12-01T09:30:00.000Z",
              receivedAt: "2026-12-01T09:32:00.000Z",
            },
          ],
          page: pageInfo,
        })
      : path.endsWith(`/sponsors/${sponsorId}/leads`)
        ? sponsorLeadListSchema.parse({
            leads: [
              {
                id: leadId,
                userId: leadId,
                name: "Synthetic attendee",
                email: "demo@example.test",
                organization: "Example organization",
                capturedAt: "2026-12-01T09:30:00.000Z",
                operatorUserId: operatorId,
                operatorName: "Demo operator",
              },
            ],
            page: pageInfo,
          })
        : sponsorLeadSponsorsSchema.parse({
            sponsors: [{ id: sponsorId, name: "Example sponsor", canView: true, canCapture: false, canExport: false }],
            page: pageInfo,
          });
    await route.fulfill({ json: payload, headers: { "cache-control": "private, no-store" } });
  });
  await page.goto(`/portal/#/groups/${encodeURIComponent(ownerGroupId!)}/events/${encodeURIComponent(event.id)}/leads`);
  // Hash navigation can reuse the authenticated shell; reload to hydrate the synthetic contextual grant.
  await page.reload();
  await page.getByRole("button", { name: "Open leads for Example sponsor", exact: true }).click();
  const contacts = page.getByRole("region", { name: "Consenting leads", exact: true });
  await expect(contacts.getByText("Synthetic attendee", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search consenting leads", exact: true }).fill("Synthetic");
  await page.getByRole("searchbox", { name: "Search consenting leads", exact: true }).press("Enter");
  await expect
    .poll(() =>
      requests.some(
        (url) => url.pathname.endsWith(`/sponsors/${sponsorId}/leads`) && url.searchParams.get("q") === "Synthetic",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "View capture history for Synthetic attendee", exact: true }).click();
  await expect(page.getByRole("region", { name: "Lead capture history", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Device time \(unverified\)/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Server receipt/ })).toBeVisible();
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
  await expect(page.getByText("Synthetic attendee", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Synthetic attendee", { exact: true })).toHaveCount(0);
});
