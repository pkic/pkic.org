import { expect, test, type Locator } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { signInToPortal } from "./helpers/portal-auth";
import {
  matrixTitle,
  prepareAgendaInteractionFixture,
  prepareMatrixStaffing,
} from "./helpers/agenda-interaction-fixture";
import { prepareSponsorLiveFixture, captureSponsorBadge, sponsorEventSlug } from "./helpers/sponsor-live-fixture";
import { sponsorLeadListSchema } from "../../assets/shared/schemas/event-sponsor-lead-list";
import { agendaStaffingSchema } from "../../assets/shared/schemas/event-agenda";
import { agendaScheduleApplySchema } from "../../assets/shared/schemas/event-agenda-schedule";
import { formatTimeRangeInZone } from "../../assets/shared/format-date";
import { initialsFrom } from "../../assets/ts/shared/initials";

async function expectReadingBounds(content: Locator) {
  const bounds = await content.evaluate((element) => {
    const detail = element.closest(".pk-table__detail-content")!;
    const viewport = detail.closest(".pk-table__scroll")!;
    const box = viewport.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].map((rect) => ({
      left: rect.left - box.left - viewport.clientLeft,
      right: rect.right - box.left - viewport.clientLeft,
      width: viewport.clientWidth,
    }));
  });
  expect(bounds.length).toBeGreaterThan(0);
  for (const rect of bounds) {
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.right).toBeLessThanOrEqual(rect.width + 1);
  }
}

for (const mode of ["keyboard", "touch", "pointer"] as const) {
  test.describe(`agenda ${mode} interaction`, () => {
    test.use({
      viewport: mode === "touch" ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      hasTouch: mode === "touch",
      isMobile: mode === "touch",
    });
    test("resize selection refuses invalid targets and commits only after explicit review", async ({ page }, info) => {
      test.setTimeout(180_000);
      await signInAsE2eStaff(
        page,
        e2eAdminEmail(
          mode === "keyboard"
            ? "portal-agenda-preview"
            : mode === "touch"
              ? "portal-agenda-publication-layout"
              : "portal-agenda-accepted-placement",
        ),
      );
      const fixture = await prepareAgendaInteractionFixture(page);
      await page.goto(`/portal/#/events/${fixture.slug}/agenda`);
      const activate = async (control: Locator) => {
        await expect(control).toBeVisible();
        if (mode === "touch") await control.tap();
        else if (mode === "pointer") await control.click();
        else {
          await control.focus();
          await control.press("Enter");
        }
      };
      await expect(page.getByRole("heading", { name: matrixTitle, exact: true })).toBeVisible();
      const roomNames = ["Main auditorium", "Workshop room", "Community discussion room"];
      if (mode !== "touch")
        for (const room of roomNames)
          await expect(page.getByRole("columnheader", { name: room, exact: true })).toBeVisible();

      await activate(page.getByRole("button", { name: `Open session details: ${matrixTitle}`, exact: true }));
      const panel = page.getByRole("dialog", { name: matrixTitle, exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Speakers", exact: true })).toBeVisible();
      for (const person of fixture.people)
        await expect(panel.getByRole("heading", { name: person.name, exact: true })).toBeVisible();
      await expect(panel.getByText("Moderator", { exact: true })).toBeVisible();
      await expect(panel.getByRole("article")).toHaveCount(2);
      for (const person of fixture.people) {
        const speaker = panel.getByRole("article").filter({
          has: page.getByRole("heading", { name: person.name, exact: true }),
        });
        await expect(speaker.getByText(initialsFrom(person.name), { exact: true })).toBeVisible();
        await expect(speaker.locator("img")).toHaveCount(0);
      }
      const panelBounds = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const headings = [...element.querySelectorAll("h2, h3")].map((heading) => {
          const box = heading.getBoundingClientRect();
          return { left: box.left, right: box.right };
        });
        return { left: rect.left, right: rect.right, viewport: innerWidth, headings };
      });
      expect(panelBounds.left).toBeGreaterThanOrEqual(-1);
      expect(panelBounds.right).toBeLessThanOrEqual(panelBounds.viewport + 1);
      for (const heading of panelBounds.headings) {
        expect(heading.left).toBeGreaterThanOrEqual(panelBounds.left - 1);
        expect(heading.right).toBeLessThanOrEqual(panelBounds.right + 1);
      }
      await page.screenshot({ path: info.outputPath(`named-panel-missing-portraits-${mode}.png`), fullPage: true });
      await activate(panel.getByRole("button", { name: "Close session details", exact: true }));
      await expect(panel).toBeHidden();
      const step = page.getByLabel("Scheduling time step", { exact: true });
      await step.selectOption("15");
      const before = await fixture.read();
      const edge = page.getByRole("button", { name: `Resize ${matrixTitle} by dragging to an end time`, exact: true });
      if (mode === "pointer") {
        await edge.scrollIntoViewIfNeeded();
        const box = await edge.boundingBox();
        if (!box) throw new Error("Resize edge has no native pointer geometry");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 12, { steps: 8 });
      } else await activate(edge);
      await expect(page.getByRole("status").filter({ hasText: "Choose an end time" })).toBeVisible();
      for (const room of roomNames)
        await expect(
          page.getByRole("button", { name: new RegExp(`^End selected session at .* in ${room}$`) }).first(),
        ).toBeVisible();
      const invalid = page.getByRole("button", { name: /End selected session at .* in Workshop room$/ }).first();
      await expect(invalid).toBeDisabled();
      expect(await fixture.read()).toEqual(before);
      const desiredEnd = new Date(Date.parse(fixture.occurrence.endAt!) + 15 * 60_000).toISOString();
      const candidateName = `End selected session at ${formatTimeRangeInZone(desiredEnd, undefined, "UTC")} in Main auditorium`;
      if (mode !== "pointer") {
        await step.selectOption("1");
        await expect(
          page.getByRole("button", {
            name: `End selected session at ${formatTimeRangeInZone("2027-09-10T09:57:00.000Z", undefined, "UTC")} in Main auditorium`,
            exact: true,
          }),
        ).toBeEnabled();
        await step.selectOption("15");
      }
      const destination = page.getByRole("button", { name: candidateName, exact: true });
      await expect(destination).toBeEnabled();
      const reviewing = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${fixture.endpoint}/schedule/reviews` &&
          response.request().method() === "POST",
      );
      if (mode === "pointer") {
        await destination.scrollIntoViewIfNeeded();
        const box = await destination.boundingBox();
        if (!box) throw new Error("Resize destination has no native pointer geometry");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
        const hit = await destination.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return target !== null && element.contains(target);
        });
        expect(hit).toBe(true);
        await page.mouse.up();
      } else await activate(destination);
      const reviewResponse = await reviewing;
      expect(reviewResponse.status(), reviewResponse.status() === 200 ? undefined : await reviewResponse.text()).toBe(
        200,
      );
      await expect(page.getByRole("heading", { name: "Review schedule changes", exact: true })).toBeVisible();
      expect(await fixture.read()).toEqual(before);
      const apply = page.getByRole("button", { name: "Apply reviewed schedule", exact: true });
      await expect(apply).toBeEnabled();
      const applying = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${fixture.endpoint}/schedule` && response.request().method() === "POST",
      );
      await activate(apply);
      const response = await applying;
      expect(response.status()).toBe(200);
      const command = agendaScheduleApplySchema.parse(response.request().postDataJSON());
      expect(command.expectedRevision).toBe(before.revision);
      expect(command.changes).toHaveLength(1);
      const change = command.changes[0]!;
      expect(change).toMatchObject({
        id: fixture.occurrence.id,
        startAt: fixture.occurrence.startAt,
        roomId: fixture.room.id,
      });
      expect(candidateName).toBe(
        `End selected session at ${formatTimeRangeInZone(change.endAt!, undefined, "UTC")} in Main auditorium`,
      );
      expect(change.endAt).toBe(desiredEnd);
      expect(new Date(change.endAt!).getUTCMinutes() % 15).toBe(0);
      const after = await fixture.read();
      expect(after.revision).toBe(before.revision + 1);
      expect(after.occurrences.find((row) => row.id === fixture.occurrence.id)?.endAt).toBe(change.endAt);
      await expect(page.getByRole("heading", { name: "Review schedule changes", exact: true })).toHaveCount(0);
      await activate(
        page.getByRole("button", { name: `Resize ${matrixTitle} by dragging to an end time`, exact: true }),
      );
      await activate(page.getByRole("button", { name: "Cancel selection", exact: true }));
      expect(await fixture.read()).toEqual(after);
      await expect(page.getByRole("button", { name: /^End selected session at/ })).toHaveCount(0);
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(mode === "touch" ? 390 : 1280);
        await page.screenshot({ path: info.outputPath(`three-room-long-title-${mode}-${theme}.png`), fullPage: true });
      }
    });
    if (mode !== "pointer")
      test("staffing supports manual pinned assignment and workload review", async ({ page }, info) => {
        test.setTimeout(180_000);
        await signInAsE2eStaff(
          page,
          e2eAdminEmail(mode === "keyboard" ? "portal-agenda-staffing-roster" : "portal-event-attendee-management"),
        );
        const fixture = await prepareAgendaInteractionFixture(page);
        const staffing = await prepareMatrixStaffing(page, fixture);
        const activate = async (control: Locator) => {
          await expect(control).toBeVisible();
          if (mode === "touch") await control.tap();
          else {
            await control.focus();
            await control.press("Enter");
          }
        };
        await page.goto(`/portal/#/events/${fixture.slug}/agenda`);
        await activate(page.getByRole("tab", { name: "Block roles", exact: true }));
        await expect(page.getByText(staffing.blockName, { exact: true })).toBeVisible();
        const blockMenu = page.getByRole("button", { name: `Actions for ${staffing.blockName}`, exact: true });
        if (mode === "keyboard") {
          await blockMenu.focus();
          await blockMenu.press("ArrowDown");
          await expect(page.getByRole("menu")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(blockMenu).toBeFocused();
          expect(await fixture.read()).toEqual(staffing.configured);
        }
        await activate(blockMenu);
        await activate(page.getByRole("menuitem", { name: "Review staffing", exact: true }));
        await activate(page.getByRole("button", { name: "Actions for Matrix MC · Event", exact: true }));
        await activate(page.getByRole("menuitem", { name: "Review positions", exact: true }));
        await expect(page.getByRole("region", { name: "Unfilled staffing duties", exact: true })).toContainText(
          "2 uncovered duties",
        );
        await activate(page.getByRole("button", { name: "Actions for Position 1", exact: true }));
        await activate(page.getByRole("menuitem", { name: "Edit assignment", exact: true }));
        const person = page.getByLabel("Assigned person", { exact: true });
        await expect(person).toBeEnabled();
        if (mode === "keyboard") {
          await person.focus();
          await person.press("m");
          await person.press("Tab");
          await expect(person).toHaveValue(fixture.people[0]!.id);
        } else await person.selectOption(fixture.people[0]!.id);
        const pin = page.getByRole("checkbox", { name: "Pin assignment during rotation", exact: true });
        if (mode === "touch") await pin.tap();
        else {
          await pin.focus();
          await pin.press("Space");
        }
        await expect(pin).toBeChecked();
        const before = await fixture.read();
        expect(before).toEqual(staffing.configured);
        const saving = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `${fixture.endpoint}/staffing` &&
            response.request().method() === "POST",
        );
        await activate(page.getByRole("button", { name: "Save assignment", exact: true }));
        const response = await saving;
        expect(response.status()).toBe(200);
        const command = agendaStaffingSchema.parse(response.request().postDataJSON());
        expect(command.expectedRevision).toBe(before.revision);
        expect(command.assignments).toEqual([
          expect.objectContaining({
            positionId: staffing.positionId,
            userId: fixture.people[0]!.id,
            pinned: true,
            origin: "manual",
          }),
        ]);
        const after = await fixture.read();
        expect(after.revision).toBe(before.revision + 1);
        expect(after.assignments).toEqual(command.assignments);
        expect(after.staffingReport!.uncovered).toHaveLength(1);
        expect(after.staffingReport!.people.find((value) => value.userId === fixture.people[0]!.id)).toMatchObject({
          minutes: 30,
          pinnedCount: 1,
          manualCount: 1,
        });
        await expect(page.getByRole("button", { name: "Save assignment", exact: true })).toHaveCount(0);
        await activate(page.getByRole("tab", { name: "People", exact: true }));
        const roster = page.getByRole("region", { name: "Staffing workload roster", exact: true });
        const personReport = after.staffingReport!.people.find((value) => value.userId === fixture.people[0]!.id)!;
        const row = roster.getByRole("row").filter({ hasText: personReport.displayName });
        await expect(row.getByRole("cell").nth(1)).toContainText("30");
        await expect(row.getByRole("cell").nth(2)).toContainText("1");
        await expect(row.getByRole("cell").nth(3)).toContainText("1");
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(mode === "touch" ? 390 : 1280);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: info.outputPath(`staffing-manual-pin-workload-${mode}.png`), fullPage: true });
      });
  });
}

test("expanded sponsor history prose and inner history fit their visible desktop and phone viewport", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const staffContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const attendeeContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  try {
    const fixture = await prepareSponsorLiveFixture(await staffContext.newPage(), await attendeeContext.newPage());
    await signInToPortal(page, fixture.operator.email);
    await page.goto(fixture.workspace);
    await page.getByRole("button", { name: /^Open leads for/ }).click();
    await page.getByRole("button", { name: "Scan leads", exact: true }).click();
    await page.getByLabel("Feedback pause", { exact: true }).selectOption("0");
    await captureSponsorBadge(page, fixture.consenting.badgeId, fixture.sponsorId, fixture.operator.userId);
    await page.getByRole("button", { name: "Close scanner", exact: true }).click();
    const leads = sponsorLeadListSchema.parse(
      await (await page.request.get(`/api/v1/events/${sponsorEventSlug}/sponsors/${fixture.sponsorId}/leads`)).json(),
    );
    const lead = leads.leads.find((row) => row.email === fixture.email)!;
    await page.getByRole("button", { name: `View capture history for ${lead.name}`, exact: true }).click();
    await expect(page.getByRole("region", { name: "Lead capture history", exact: true })).toBeVisible();
    const prose = page
      .locator(".pk-table__detail-content p")
      .filter({ hasText: "These records do not imply attendance." });
    await expect(prose).toHaveCount(1);
    for (const [name, width] of [
      ["desktop", 1280],
      ["phone", 390],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const detail = page.locator(".pk-table__detail-content").first();
      for (const edge of ["start", "end"] as const) {
        await detail.evaluate((element, side) => {
          const outer = element.closest(".pk-table__scroll")!;
          outer.scrollLeft = side === "start" ? 0 : outer.scrollWidth - outer.clientWidth;
        }, edge);
        await expectReadingBounds(prose);
        const geometry = await detail.evaluate((element) => {
          const outer = element.closest(".pk-table__scroll")!.getBoundingClientRect();
          const inner = element.querySelector(".pk-table__scroll")!.getBoundingClientRect();
          return { left: inner.left - outer.left, right: inner.right - outer.left, width: outer.width };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(-1);
        expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
      }
      await detail.evaluate((element) => {
        element.closest(".pk-table__scroll")!.scrollLeft = 0;
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`expanded-history-reading-${name}.png`), fullPage: true });
    }
  } finally {
    await staffContext.close();
    await attendeeContext.close();
  }
});
