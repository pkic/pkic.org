/**
 * Real-browser proof of the SVG-only logo pipeline: a staff user picks an
 * SVG file in the organization detail UI, the worker sanitizes and stores
 * it, and the publicly served file comes back cropped, dimensionless, and
 * with every hostile construct gone.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const UPLOAD_SVG = Buffer.from(
  '<?xml version="1.0"?><!-- exported by Editor 9000 -->' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300" onload="alert(1)">' +
    "<script>fetch('https://evil.test')</script>" +
    '<rect width="100%" height="100%" fill="#ffffff"/>' +
    '<rect x="100" y="100" width="100" height="100" fill="#123456" onclick="alert(2)"/>' +
    "</svg>",
  "utf-8",
);

test("staff upload an SVG logo through the UI and the served file is sanitized", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const organizationName = `SVG Logo Organization ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-organizations"));
  await page.goto("/portal/#/organizations");
  await page.getByRole("button", { name: "Add organization", exact: true }).click();
  // Creation is its own routed view, not a panel above the directory.
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/new$/);
  const createForm = page.getByRole("region", { name: "Add organization" });
  const organizationGroup = createForm.getByRole("group", { name: "Details", exact: true });
  await organizationGroup.getByLabel("Organization name").fill(organizationName);
  await organizationGroup.getByLabel("Membership category").selectOption("F");
  await organizationGroup.getByLabel("Member since").fill("2026-01-15");
  await createForm.getByRole("button", { name: "Add person", exact: true }).click();
  const firstPerson = createForm.getByRole("group", { name: "Person 1" });
  await firstPerson.getByLabel("Name").fill("Logo Representative");
  await firstPerson.getByLabel("Email").fill(`svg-logo-${suffix}@example.invalid`);
  // Adding a person activates them at once, so the form requires a reason for
  // it. Leaving it empty does not fail the request — the browser refuses to
  // submit at all, and nothing is ever created.
  await createForm.getByLabel("Reason for activating without an invitation").fill("E2E SVG logo setup");
  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/organizations" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create organization" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByText("Organization created", { exact: true })).toBeVisible();

  // Success lands on the created organization's own detail view.
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible();
  const organizationId = decodeURIComponent(page.url().split("/organizations/")[1].split(/[/?#]/)[0]);

  await page.locator('input[type="file"][accept="image/svg+xml"]').setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: UPLOAD_SVG,
  });
  await expect(page.locator(".my-toast", { hasText: "Logo uploaded" })).toBeVisible({ timeout: 15_000 });

  const served = await page.request.get(`/api/v1/members/${organizationId}/logo`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/svg+xml");
  expect(served.headers()["content-security-policy"]).toContain("default-src 'none'");

  const body = await served.text();
  const root = /<svg\b[^>]*>/.exec(body)![0];
  for (const forbidden of ["script", "onload", "onclick", "Editor 9000", "#ffffff"]) {
    expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
  expect(root).not.toMatch(/\swidth\s*=/);
  expect(root).not.toMatch(/\sheight\s*=/);
  const viewBox = /viewBox\s*=\s*"([^"]+)"/
    .exec(root)![1]
    .split(/[\s,]+/)
    .map(Number);
  expect(viewBox[2]).toBeCloseTo(100, 0);
  expect(viewBox[3]).toBeCloseTo(100, 0);
});
