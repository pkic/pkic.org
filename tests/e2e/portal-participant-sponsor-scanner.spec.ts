import { accessGrantCreateSchema, accessGrantCreateResponseSchema } from "../../assets/shared/schemas/access-control";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { sessionHistoryCorrectionSchema } from "../../assets/shared/schemas/event-session-history";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { individualAppearanceFixture } from "../helpers/agenda-appearances";
import { agendaRevisionSchema } from "../../assets/shared/schemas/event-agenda";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { prepareAgendaInteractionFixture } from "./helpers/agenda-interaction-fixture";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { expect, test } from "@playwright/test";
import { sponsorLeadSponsorsSchema } from "../../assets/shared/schemas/event-sponsor-lead-list";
import { signInToPortal } from "./helpers/portal-auth";
import { openScannerManualEntry } from "./helpers/scanner-recovery-storage";
import { prepareSponsorLiveFixture, sponsorEventSlug } from "./helpers/sponsor-live-fixture";

test.use({ actionTimeout: 20_000 });

/** The participant route uses real sponsor grants and native camera fallback, without transport interception. */
test("participant sponsor scanner keeps its sponsor context and manual exit controls on phone and tablet", async ({
  page,
  browser,
  context,
}, info) => {
  test.setTimeout(300_000);
  const staffContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const attendeeContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  let endFixture: (() => Promise<void>) | undefined;
  try {
    const fixture = await prepareSponsorLiveFixture(await staffContext.newPage(), await attendeeContext.newPage());
    endFixture = fixture.end;
    await signInToPortal(page, fixture.operator.email);
    const discovery = await page.request.get(`/api/v1/events/${sponsorEventSlug}/sponsors/leads`);
    expect(discovery.status()).toBe(200);
    const sponsor = sponsorLeadSponsorsSchema
      .parse(await discovery.json())
      .sponsors.find((row) => row.id === fixture.sponsorId);
    if (!sponsor) throw new Error("Synthetic operator's authorized sponsor was absent from discovery");
    expect(sponsor.canCapture).toBe(true);
    await context.clearPermissions();
    const route = `/portal/#/events/${sponsorEventSlug}/sponsors/${fixture.sponsorId}/scanner`;
    for (const viewport of [
      { name: "phone", width: 390, height: 844 },
      { name: "tablet", width: 820, height: 1180 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(route);
      await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${viewport.name}-sponsor-initial-setup.png`), fullPage: true });
      const phone = viewport.name === "phone";
      const navigation = page.getByRole("navigation", { name: phone ? "Event app" : "Event", exact: true });
      await navigation.getByRole("link", { name: phone ? "Home" : "Overview", exact: true }).click();
      await expect(page).toHaveURL(`/portal/#/events/${sponsorEventSlug}`);
      const leadEntry = navigation.getByRole("link", { name: phone ? "Leads" : "Lead scanner", exact: true });
      await expect(leadEntry).toHaveAttribute(
        "href",
        `#/events/${sponsorEventSlug}/sponsors/${fixture.sponsorId}/scanner`,
      );
      await leadEntry.click();
      await expect(page).toHaveURL(route);
      await expect(page.getByText(`${sponsor.name} · Event-wide`, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Event entrance", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
      await expect(page.getByText("Capture sponsor lead", { exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Scan mode", exact: true })).toHaveCount(0);
      const start = page.getByRole("button", { name: "Start scanning", exact: true });
      const enter = page.getByRole("button", { name: "Manual entry", exact: true });
      await expect(enter).toBeVisible();
      const startBounds = await start.boundingBox();
      const enterBounds = await enter.boundingBox();
      if (!startBounds || !enterBounds) throw new Error("Scanner action buttons need visible bounds");
      expect(Math.abs(startBounds.y - enterBounds.y)).toBeLessThanOrEqual(1);
      if (viewport.name === "phone") {
        for (const bounds of [startBounds, enterBounds]) {
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        }
      }
      await page.screenshot({ path: info.outputPath(`${viewport.name}-sponsor-setup.png`), fullPage: true });

      await openScannerManualEntry(page);
      const manual = page.getByRole("dialog", { name: "Review sponsor lead", exact: true });
      await manual.getByLabel("Badge code", { exact: true }).fill(fixture.consenting.badgeId);
      await expect(
        manual.getByLabel("The attendee agrees to share their contact details with this sponsor.", { exact: true }),
      ).toBeVisible();
      await expect(
        manual.getByLabel("The attendee agrees to share their contact details with this sponsor.", { exact: true }),
      ).not.toBeChecked();
      await page.screenshot({ path: info.outputPath(`${viewport.name}-sponsor-manual.png`), fullPage: true });
      await manual.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(manual).toHaveCount(0);

      await page.getByRole("button", { name: "Start scanning", exact: true }).click();
      const scanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
      await expect(scanner).toBeVisible();
      await expect(
        scanner.getByText(`${sponsor.name} · Event-wide · Capture sponsor lead`, { exact: true }),
      ).toBeVisible();
      await expect(scanner.getByText(/Event entrance/)).toHaveCount(0);
      await expect(
        scanner.getByRole("status").getByText("Ready to capture sponsor leads", { exact: true }),
      ).toBeVisible();
      await expect(scanner.getByText(/Admission requires verification/)).toHaveCount(0);
      await expect(scanner.getByRole("button", { name: "Manual entry", exact: true })).toBeVisible();
      await expect(scanner.getByRole("button", { name: "Exit", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${viewport.name}-sponsor-fullscreen.png`), fullPage: true });
      await scanner.getByRole("button", { name: "Manual entry", exact: true }).click();
      // Inside the full-screen scanner, manual entry replaces the camera view instead of opening a second dialog.
      const inlineEntry = scanner.getByRole("heading", { name: "Manual entry", level: 2, exact: true });
      await expect(inlineEntry).toBeVisible();
      await scanner.getByRole("button", { name: "Return to scanning", exact: true }).click();
      await expect(inlineEntry).toHaveCount(0);
      await scanner.getByRole("button", { name: "Exit", exact: true }).click();
      await expect(scanner).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeVisible();
      await expect(page.getByText(`${sponsor.name} · Event-wide`, { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${viewport.name}-sponsor-after-manual.png`), fullPage: true });
      await page.getByRole("button", { name: "Start scanning", exact: true }).click();
      await expect(scanner).toBeVisible();
      await scanner.getByRole("button", { name: "Exit", exact: true }).click();
      await expect(scanner).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
      await expect(page.getByText(`${sponsor.name} · Event-wide`, { exact: true })).toBeVisible();
    }
  } finally {
    await endFixture?.();
    await staffContext.close();
    await attendeeContext.close();
  }
});

test("event staff scanner shows its published session and room at phone and tablet widths", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  const fixture = await prepareAgendaInteractionFixture(page);
  let snapshot = await fixture.read();
  for (const occurrence of snapshot.occurrences.filter((value) => value.speakers.length)) {
    const reviewed = await page.request.post(`${fixture.endpoint}/occurrences/${occurrence.id}/history`, {
      data: sessionHistoryCorrectionSchema.parse({
        expectedRevision: snapshot.revision,
        history: {
          ...occurrence.history,
          appearances: occurrence.speakers.map(({ userId }) => {
            const person = fixture.people.find((value) => value.id === userId);
            if (!person) throw new Error("Synthetic speaker identity was absent from its fixture");
            return individualAppearanceFixture({
              userId,
              displayName: person.name,
              approvedAt: new Date().toISOString(),
            });
          }),
        },
      }),
    });
    expect(reviewed.status(), await reviewed.text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await reviewed.json());
  }
  const published = await page.request.post(`${fixture.endpoint}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
  });
  expect(published.status(), await published.text()).toBe(200);
  await context.clearPermissions();
  const contextLabel = `${fixture.occurrence.title} · ${fixture.room.name}`;
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/portal/#/events/${fixture.slug}/scanner?session=${fixture.occurrence.id}`);
    await expect(page.getByText(contextLabel, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`${viewport.name}-staff-setup.png`), fullPage: true });
    await page.getByRole("button", { name: "Choose session or room", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose check-in session", exact: true });
    await expect(picker).toBeVisible();
    for (const name of ["Now", "Next", "My shifts", "Browse days and rooms"])
      await expect(picker.getByRole("tab", { name, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${viewport.name}-staff-picker.png`), fullPage: true });
    await picker.getByRole("button", { name: "Close", exact: true }).click();
    await openScannerManualEntry(page);
    const manual = page.getByRole("dialog", { name: "Enter badge code", exact: true });
    await expect(manual.getByLabel("Badge code", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${viewport.name}-staff-manual.png`), fullPage: true });
    await manual.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Start scanning", exact: true }).click();
    const scanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
    await expect(scanner).toBeVisible();
    await expect(scanner.getByText(`${contextLabel} · Record attendance`, { exact: true })).toBeVisible();
    await expect(scanner.getByRole("button", { name: "Manual entry", exact: true })).toBeVisible();
    await expect(scanner.getByRole("button", { name: "Exit", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${viewport.name}-staff-fullscreen.png`), fullPage: true });
    await scanner.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(scanner).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.getByText(contextLabel, { exact: true })).toBeVisible();
  }
});

test("authorized group and event creation stays accessible in collection toolbars across viewport sizes", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    for (const surface of [
      { name: "groups", route: "/portal/#/groups", toolbar: "Groups controls", create: "New group" },
      {
        name: "events",
        route: "/portal/#/groups/20000000-0000-4000-8000-000000000003/events",
        toolbar: "Upcoming group events controls",
        create: "Create event",
      },
    ]) {
      await page.goto(surface.route);
      const toolbar = page.getByRole("toolbar", { name: surface.toolbar, exact: true });
      const create = toolbar.getByRole("button", { name: surface.create, exact: true });
      await expect(create).toBeVisible();
      await expect(create).toBeEnabled();
      await toolbar.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`${viewport.name}-${surface.name}-create-toolbar.png`),
        fullPage: true,
      });
      const geometry = await toolbar.evaluate((element) => {
        const bar = element.getBoundingClientRect();
        const controls = [...element.querySelectorAll<HTMLElement>("button, input, select, a")]
          .filter((control) => control.getClientRects().length)
          .map((control) => {
            const box = control.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
          });
        return {
          left: bar.left,
          right: bar.right,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          controls,
        };
      });
      expect(geometry.controls.length).toBeGreaterThan(1);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width);
      for (const control of geometry.controls) {
        expect(control.left).toBeGreaterThanOrEqual(geometry.left - 1);
        expect(control.right).toBeLessThanOrEqual(geometry.right + 1);
      }
      expect(Math.max(...geometry.controls.map((control) => control.top))).toBeLessThan(
        Math.min(...geometry.controls.map((control) => control.bottom)),
      );
      await create.focus();
      await expect(create).toBeFocused();
    }
  }
});

/** One ordinary identity can staff the entrance and capture its sponsor's leads without changing accounts. */
test("dual staff and sponsor identity reaches both event scanners across phone tablet and desktop", async ({
  page,
  browser,
  context,
}, info) => {
  test.setTimeout(300_000);
  const staffContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const attendeeContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  let endFixture: (() => Promise<void>) | undefined;
  try {
    const staff = await staffContext.newPage();
    const fixture = await prepareSponsorLiveFixture(staff, await attendeeContext.newPage());
    endFixture = fixture.end;
    const eventResponse = await staff.request.get(`/api/v1/events/${sponsorEventSlug}`);
    expect(eventResponse.status()).toBe(200);
    const event = eventDetailResponseSchema.parse(await eventResponse.json()).event;
    const grantResponse = await staff.request.post("/api/v1/permissions/grants", {
      data: accessGrantCreateSchema.parse({
        userId: fixture.operator.userId,
        permission: "agenda:scan",
        contextType: "event",
        contextId: event.id,
      }),
    });
    expect(grantResponse.status()).toBe(201);
    const grant = accessGrantCreateResponseSchema.parse(await grantResponse.json()).grant;
    expect(grant).toMatchObject({
      userId: fixture.operator.userId,
      permission: "agenda:scan",
      contextType: "event",
      contextId: event.id,
    });
    await signInToPortal(page, fixture.operator.email);
    await context.clearPermissions();
    const discovery = await page.request.get(`/api/v1/events/${sponsorEventSlug}/sponsors/leads`);
    expect(discovery.status()).toBe(200);
    const sponsor = sponsorLeadSponsorsSchema
      .parse(await discovery.json())
      .sponsors.find((entry) => entry.id === fixture.sponsorId);
    if (!sponsor) throw new Error("The dual-role identity must retain its sponsor grant");
    expect(sponsor.canCapture).toBe(true);
    const staffRoute = `/portal/#/events/${sponsorEventSlug}/scanner`;
    const leadRoute = `/portal/#/events/${sponsorEventSlug}/sponsors/${fixture.sponsorId}/scanner`;
    for (const viewport of [
      { name: "phone", width: 390, height: 844 },
      { name: "tablet", width: 820, height: 1180 },
      { name: "desktop", width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/portal/#/events/${sponsorEventSlug}`);
      const phone = viewport.name === "phone";
      const navigation = page.getByRole("navigation", { name: phone ? "Event app" : "Event", exact: true });
      const scanEntry = navigation.getByRole("link", { name: phone ? "Scan" : "Badge scanner", exact: true });
      await expect(scanEntry).toHaveAttribute("href", `#/events/${sponsorEventSlug}/scanner`);
      await scanEntry.click();
      await expect(page).toHaveURL(staffRoute);
      await page.getByRole("button", { name: "Event entrance", exact: true }).click();
      const mode = page.getByRole("combobox", { name: "Scan mode", exact: true });
      await mode.selectOption("attendance");
      await expect(mode).toHaveValue("attendance");
      await page.getByRole("button", { name: "Start scanning", exact: true }).click();
      const scanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
      await expect(scanner.getByText("Event entrance · Record attendance", { exact: true })).toBeVisible();
      await expect(scanner.getByText(/Capture sponsor lead/)).toHaveCount(0);
      await scanner.getByRole("button", { name: "Exit", exact: true }).click();
      await expect(scanner).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: info.outputPath(`${viewport.name}-dual-role-staff-scanner.png`), fullPage: true });
      let leadEntry;
      if (phone) {
        await navigation.getByRole("button", { name: "More", exact: true }).click();
        const more = page.getByRole("dialog", { name: "More", exact: true });
        leadEntry = more.getByRole("link", { name: "Lead scanner", exact: true });
        await expect(leadEntry).toBeVisible();
        await page.screenshot({ path: info.outputPath("phone-dual-role-more-leads.png"), fullPage: true });
      } else {
        leadEntry = navigation.getByRole("link", { name: "Lead scanner", exact: true });
      }
      await expect(leadEntry).toHaveAttribute(
        "href",
        `#/events/${sponsorEventSlug}/sponsors/${fixture.sponsorId}/scanner`,
      );
      await leadEntry.click();
      await expect(page).toHaveURL(leadRoute);
      await expect(page.getByText(`${sponsor.name} · Event-wide`, { exact: true })).toBeVisible();
      await expect(page.getByText("Capture sponsor lead", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Event entrance", exact: true })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Scan mode", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Start scanning", exact: true }).click();
      await expect(
        scanner.getByText(`${sponsor.name} · Event-wide · Capture sponsor lead`, { exact: true }),
      ).toBeVisible();
      await expect(scanner.getByText(/Record attendance/)).toHaveCount(0);
      await scanner.getByRole("button", { name: "Exit", exact: true }).click();
      await expect(scanner).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: info.outputPath(`${viewport.name}-dual-role-sponsor-scanner.png`),
        fullPage: true,
      });
    }
  } finally {
    await endFixture?.();
    await staffContext.close();
    await attendeeContext.close();
  }
});
