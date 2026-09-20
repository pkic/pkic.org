import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { membershipWorkflowVersionResponseSchema } from "../../assets/shared/schemas/membership-workflows";
import { membershipPaymentSessionSchema } from "../../assets/shared/schemas/membership-payments";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { submitMembershipApplication, uniqueSuffix } from "./helpers/membership";
import { jsonResponse } from "./helpers/member-provisioning";

/** @covers join.1.2.a */
for (const staffReview of [false, true]) {
  test(`${staffReview ? "staff review and payment" : "payment-only"} membership requires a signed fee event after checkout`, async ({
    page,
  }, testInfo) => {
    await signInAsE2eStaff(
      page,
      e2eAdminEmail(staffReview ? "membership-workflows-staff-review-payment" : "membership-workflows-payment-only"),
    );
    const suffix = uniqueSuffix();
    const version = membershipWorkflowVersionResponseSchema.parse(
      await jsonResponse(page.request, "POST", "/api/v1/membership/workflows/versions", {
        definition: {
          name: `Paid organizations ${suffix}`,
          policyReference: "Synthetic adopted payment policy",
          steps: [
            ...(staffReview
              ? [
                  {
                    id: crypto.randomUUID(),
                    kind: "staff_review",
                    label: "Review organization form",
                    instructions: "Verify the organization and the submitting user's authority.",
                    reviewerGroupId: null,
                  },
                ]
              : []),
            {
              id: crypto.randomUUID(),
              kind: "payment",
              label: "Confirm membership payment",
              instructions: "Pay the required fee for Example Organization.",
              feeReference: "synthetic-organization-fee",
              amount: 10000,
              currency: "usd",
              deadlineDays: 30,
            },
          ],
        },
      }),
    );
    await jsonResponse(
      page.request,
      "POST",
      `/api/v1/membership/workflows/versions/${version.workflow.id}/publication`,
      {
        expectedRevision: version.workflow.revision,
        reason: "Adopt a synthetic fee policy for browser verification.",
      },
    );
    const category = `PAY_${Date.now()}`;
    await jsonResponse(page.request, "POST", "/api/v1/membership/categories", {
      code: category,
      label: "Example paid organization",
      description: "Synthetic browser category",
      displayOrder: 100,
      isIndividual: false,
      isVoting: false,
      active: true,
      workflowVersionId: version.workflow.id,
    });
    const application = await submitMembershipApplication(page, {
      email: `user@paid-${suffix}.test`,
      name: "Example User",
      category,
      organizationName: `Example Organization ${suffix}`,
    });
    await jsonResponse(page.request, "POST", "/api/v1/scheduler/jobs/membership_workflows/runs", {});
    const reviewUrl = `/portal/#/membership/applications/${application.applicationId}/review`;
    await page.goto(reviewUrl);
    if (staffReview) {
      await expect(page.getByRole("link", { name: "Pay membership fee" })).toHaveCount(0);
      await page
        .getByLabel("Review decision and reason")
        .fill("Verified the organization form and the user's authority.");
      await page.getByRole("button", { name: "Complete review", exact: true }).click();
    }
    await jsonResponse(page.request, "POST", "/api/v1/scheduler/jobs/membership_fee_checkouts/runs", {});
    await page.reload();
    const pay = page.getByRole("link", { name: "Pay membership fee", exact: true });
    await expect(pay).toBeVisible();
    const checkoutUrl = await pay.getAttribute("href");
    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const captureBase = readFileSync(process.env.E2E_STRIPE_URL_FILE ?? "test-results/e2e-stripe-url", "utf8").trim();
    const captured = (await (await fetch(`${captureBase}/sessions`)).json()) as Array<Record<string, unknown>>;
    const session = membershipPaymentSessionSchema.parse(captured.find((item) => item.url === checkoutUrl));
    const capturedSession = captured.find((item) => item.id === session.id)!;
    await page.route(checkoutUrl!, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Example Organization membership fee</h1><p>USD 100.00</p><button>Complete synthetic checkout</button>",
      }),
    );
    await pay.click();
    await expect(page.getByRole("heading", { name: "Example Organization membership fee" })).toBeVisible();
    await page.getByRole("button", { name: "Complete synthetic checkout" }).click();
    await page.goto(String(capturedSession.success_url));
    await expect(page.locator("[data-status-result]")).toContainText("Processing");
    await expect(page.locator("[data-status-result]")).not.toContainText("Approved");
    const timestamp = Math.floor(Date.now() / 1000);
    const event = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      created: timestamp,
      data: { object: { ...session, payment_status: "paid" } },
    });
    const signature = createHmac("sha256", "whsec_e2e_membership").update(`${timestamp}.${event}`).digest("hex");
    const response = await page.request.post("/api/v1/webhooks/stripe", {
      data: event,
      headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
    });
    expect(response.status(), await response.text()).toBe(200);
    await page.reload();
    await expect(page.locator("[data-status-result]")).toContainText("Approved");
    await expect(page.getByRole("link", { name: "Pay membership fee" })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("paid-membership-mobile.png"), fullPage: true });
  });
}
