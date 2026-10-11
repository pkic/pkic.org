/** @covers join.1.5 */
import { test, expect } from "@playwright/test";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";
import { openApplicationDetail, stageBadge, transitionCard } from "./helpers/membership";
import { reviewedManifest } from "../helpers/application-backfill";

const exec = promisify(execFile);

test("backfilled history uses the existing application list and private notes", async ({ page }) => {
  const email = e2eAdminEmail("portal-application-stages-decline");
  await signInToPortal(page, email);
  const directory = await realpath((await readFile("test-results/e2e-state-dir", "utf8")).trim());
  expect(directory).toContain("pkic-e2e.");
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    "local",
    "--local",
    "--persist-to",
    directory,
    "--json",
  ];
  const query = async (sql: string) => {
    const { stdout } = await exec("pnpm", [...args, "--command", sql], { cwd: resolve(".") });
    return (JSON.parse(stdout) as { results: Record<string, unknown>[] }[]).map((result) => result.results);
  };
  const before = await query(
    "SELECT id, normalized_email FROM users WHERE active = 1; SELECT count(*) AS n FROM email_outbox",
  );
  const actorId = before[0].find((user) => user.normalized_email === email)?.id;
  expect(typeof actorId).toBe("string");
  const manifest = reviewedManifest(directory);
  manifest.entries = manifest.entries.slice(0, 1);
  manifest.actorUserId = String(actorId);
  const entry = manifest.entries[0];
  const path = join(directory, "synthetic-application.json");
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
  await exec(
    "pnpm",
    ["import:applications", "--manifest", path, "--report", join(directory, "backfill-results.json"), "--execute"],
    { cwd: resolve(".") },
  );

  await openApplicationDetail(page, entry.mapping.applicantEmail, "declined");
  await expect(stageBadge(page, "Example User").filter({ hasText: "Declined" })).toBeVisible();
  await expect(transitionCard(page).getByText("No further transitions from this stage.")).toBeVisible();
  await tab(page, "Communications").click();
  await expect(page.getByText(/Original form: Example User's application; consent was not recorded/)).toBeVisible();
  await expect(page.getByText(/Original GitHub comment by example-reviewer/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Application history", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("backfilled-application.png"), fullPage: true });
  expect((await query("SELECT count(*) AS n FROM email_outbox"))[0]).toEqual(before[1]);
});
