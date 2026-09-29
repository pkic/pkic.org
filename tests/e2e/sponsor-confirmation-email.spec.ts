/** @covers sponsor.2.4 */
import { test, expect } from "@playwright/test";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import {
  sponsorshipCreateSchema,
  sponsorshipResponseSchema,
  sponsorshipStageUpdateSchema,
} from "../../assets/shared/schemas/sponsorship-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";

test("activating a sponsorship sends the sponsor a complete thank-you email without template tags", async ({
  page,
}) => {
  await signInToPortal(page, e2eAdminEmail("sponsor-workspace"));
  const stamp = Date.now();
  const name = `Sponsor email review ${stamp}`;
  const email = `sponsor-confirmation-${stamp}@example.test`;
  const organization = await page.request.post("/api/v1/organizations", {
    data: organizationCreateSchema.parse({ name }),
  });
  expect(organization.status(), await organization.text()).toBe(201);
  const organizationId = organizationCreateResponseSchema.parse(await organization.json()).organization.id;
  const created = await page.request.post("/api/v1/sponsors", {
    data: sponsorshipCreateSchema.parse({
      sponsorType: "consortium",
      organizationId,
      tier: "Bronze",
      renewalDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
      contactName: "Morgan Sponsor",
      contactEmail: email,
    }),
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = sponsorshipResponseSchema.parse(await created.json()).sponsorship.id;
  const since = await capturedEmailCount();
  const activated = await page.request.patch(`/api/v1/sponsors/${id}/stage`, {
    data: sponsorshipStageUpdateSchema.parse({ toStage: "active" }),
  });
  expect(activated.status(), await activated.text()).toBe(200);
  const message = await waitForCapturedEmail(email, "PKI Consortium", { since });
  const content = message.payload.content as Array<{ type: string; value: string }>;
  const plain = content.find((item) => item.type === "text/plain")?.value ?? "";
  const html = content.find((item) => item.type === "text/html")?.value ?? "";
  for (const body of [plain, html]) {
    expect(body).toContain("Morgan Sponsor");
    expect(body).toContain(name);
    expect(body).toContain("Bronze");
    expect(body).toMatch(/thank you/i);
    expect(body).not.toContain("{{");
    expect(body).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  }
  expect(plain).toMatch(/as of \d{4}-\d{2}-\d{2}/);
  expect(plain).toContain("reply to this email");
});
