import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { publishE2eSite } from "./helpers/site-publication";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const slug = "pqc-conference-amsterdam-nl";
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-progress";

test.use({ actionTimeout: 20_000 });

test("organizers build the shared agenda and browse a compact session table on desktop and phone", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await expect(page.getByRole("button", { name: "New location", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/agenda-empty.png`, fullPage: true });
  for (const [name, capacity] of [
    ["Main auditorium", "1200"],
    ["Workshop room", "80"],
  ]) {
    await page.getByRole("button", { name: "New location", exact: true }).click();
    await page.getByRole("textbox", { name: /^Location name/ }).fill(name);
    await page.getByLabel("Physical capacity", { exact: true }).fill(capacity);
    await page.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /^Location name/ })).toHaveCount(0);
  }
  const sessions = [
    ["Opening: building trust together", "2026-12-01T09:00", "2026-12-01T09:45", "Main auditorium", "preference"],
    ["Hands-on post-quantum migration", "2026-12-01T09:00", "2026-12-01T10:30", "Workshop room", "reservation"],
    ["Coffee and conversations", "2026-12-01T09:45", "2026-12-01T10:15", "Main auditorium", "preference"],
    [
      "A practical roadmap for cryptographic agility",
      "2026-12-01T10:15",
      "2026-12-01T11:00",
      "Main auditorium",
      "preference",
    ],
    ["Deploying trust at scale", "2026-12-02T09:00", "2026-12-02T10:00", "Main auditorium", "preference"],
  ];
  for (const [title, start, end, room, policy] of sessions) {
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await page.getByRole("textbox", { name: /^Session title/ }).fill(title);
    await page.getByLabel("Starts", { exact: true }).fill(start);
    await page.getByLabel("Ends", { exact: true }).fill(end);
    await page.getByLabel("Location", { exact: true }).selectOption({ label: room });
    await page.getByLabel("Admission", { exact: true }).selectOption(policy);
    await page
      .getByLabel("Description", { exact: true })
      .fill("Explore practical approaches with the PKI community, with time for discussion and questions.");
    await page.getByRole("button", { name: "Save session", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /^Session title/ })).toHaveCount(0);
  }
  await expect(page.getByText(sessions[0][0], { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/agenda-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "All sessions", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: sessions[4][0] })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/sessions-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Block roles", exact: true }).click();
  await expect(page.getByRole("button", { name: "New block", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/staffing-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/agenda-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Approve for publication", exact: true }).click();
  await expect(page.getByText(/This revision is approved/)).toBeVisible();
  const response = await page.request.get(`/api/v1/events/${slug}/agenda`);
  expect(response.status()).toBe(200);
  const approved = agendaSnapshotSchema.parse(await response.json());
  const publicRoute = approved.publicAgendaPath!;
  await publishE2eSite(page, publicRoute);
  const publicContext = await browser.newContext({ javaScriptEnabled: false, baseURL: new URL(page.url()).origin });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(publicRoute);
  await expect(publicPage.getByText(sessions[0][0], { exact: true }).first()).toBeVisible();
  await expect(publicPage.getByRole("button", { name: "New session", exact: true })).toHaveCount(0);
  await publicPage.screenshot({ path: `${artifacts}/agenda-public-approved.png`, fullPage: true });
  const publicData = await page.request.get(`${publicRoute}data.json`);
  expect(publicData.status()).toBe(200);
  expect(await publicData.text()).toContain(sessions[0][0]);
  const calendar = await page.request.get(`${publicRoute}calendar.ics`);
  expect(calendar.status()).toBe(200);
  expect(await calendar.text()).toContain(sessions[0][0]);
  const draft = await page.request.patch(`/api/v1/events/${slug}/agenda/occurrences/${approved.occurrences[0].id}`, {
    data: { expectedRevision: approved.revision, title: "Unpublished private planning title" },
  });
  expect(draft.status()).toBe(200);
  await publicPage.reload();
  await expect(publicPage.getByText("Unpublished private planning title", { exact: true })).toHaveCount(0);
  await expect(publicPage.getByText(sessions[0][0], { exact: true }).first()).toBeVisible();
  await publicContext.close();
  await page.goto(`/portal/#/events/${slug}/scanner`);
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
  await page.getByLabel("Badge code", { exact: true }).fill("11111111-1111-4111-8111-111111111111");
  await page.getByRole("button", { name: "Check badge", exact: true }).click();
  await expect(page.getByText("Unknown badge", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/scanner-phone-unknown.png`, fullPage: true });
});
