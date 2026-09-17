/** @covers form.6.3 */
import { expect, test } from "@playwright/test";
import {
  groupFormDefinitionCreateSchema,
  groupFormDefinitionResponseSchema,
} from "../../assets/shared/schemas/group-forms";
import { groupJoinSchema } from "../../assets/shared/schemas/groups";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";
test.use({ timezoneId: "Europe/Amsterdam" });

test("event forms explain where registration and proposal answers are recorded", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-users"));
  const placementId = "80000000-0000-4000-8000-000000000092";
  const formId = "80000000-0000-4000-8000-000000000093";
  const base = `/api/v1/groups/${GROUP_ID}/forms/${placementId}`;
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(`${base}/submissions`)) requests.push(request.url());
  });
  for (const purpose of ["event_registration", "proposal_submission"] as const) {
    await page.route(`**${base}`, (route) =>
      route.fulfill({
        json: groupFormDefinitionResponseSchema.parse({
          form: {
            id: formId,
            key: "organization-questions",
            purpose,
            status: "active",
            title: "Organization questions",
            description: null,
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
          placement: {
            id: placementId,
            formId,
            ownerGroupId: GROUP_ID,
            contextType: "event",
            contextRef: formId,
            audience: purpose === "event_registration" ? "attendee" : "speaker",
            active: true,
            opensAt: null,
            closesAt: null,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
          capabilities: ["view_definition", "submit", "view_responses", "manage"],
          acceptingResponses: true,
          fields: [],
        }),
      }),
    );
    await page.goto(`/portal/#/groups/${GROUP_ID}/forms/${placementId}`);
    await page.reload();
    await expect(page.getByText("Responses are part of the event records", { exact: true })).toBeVisible();
    await expect(page.getByText(/View their answers in the event’s/)).toContainText(
      purpose === "event_registration" ? "Registrations" : "Proposals",
    );
    await expect(page.getByText("No responses yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit response", exact: true })).toHaveCount(0);
    await page.unroute(`**${base}`);
  }
  expect(requests).toEqual([]);
});

test("a respondent cannot submit a form closed after they opened it", async ({ page, browser }) => {
  await signInToPortal(page, e2eAdminEmail("portal-users"));
  const member = await createMember(page);
  const created = await page.request.post(`/api/v1/groups/${GROUP_ID}/forms`, {
    data: groupFormDefinitionCreateSchema.parse({
      key: `window-${Date.now()}`,
      title: "Submission window review",
      purpose: "survey",
      fields: [{ key: "feedback", label: "Your feedback", fieldType: "text", required: true }],
    }),
  });
  expect(created.status(), await created.text()).toBe(201);
  const form = groupFormDefinitionResponseSchema.parse(await created.json());
  const route = `/portal/#/groups/${GROUP_ID}/forms/${form.placement.id}`;
  const respondentContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    timezoneId: "America/Los_Angeles",
  });
  try {
    const respondent = await respondentContext.newPage();
    await signInToPortal(respondent, member.email);
    const joined = await respondent.request.post(`/api/v1/groups/${GROUP_ID}/join`, {
      data: groupJoinSchema.parse({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
    });
    expect(joined.status(), await joined.text()).toBe(200);
    await respondent.goto(`${route}/respond`);
    await respondent.getByLabel("Your feedback").fill("An answer prepared while the form was open");

    await page.goto(`${route}/availability`);
    const availability = page.getByRole("region", { name: "Submission window review availability", exact: true });
    await expect(availability.getByText("No closing restriction", { exact: true })).toBeVisible();
    await availability.getByRole("button", { name: "Form availability actions" }).click();
    await page.getByRole("menuitem", { name: "Edit settings" }).click();
    await availability.getByLabel("Closes", { exact: true }).fill("2026-01-01T09:00");
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(`/forms/${form.placement.id}`) && response.request().method() === "PATCH",
    );
    await availability.getByRole("button", { name: "Save availability" }).click();
    expect((await saved).status()).toBe(200);
    await expect(availability.getByLabel("Closes", { exact: true })).toHaveCount(0);
    await page.reload();
    await availability.getByRole("button", { name: "Form availability actions" }).click();
    await page.getByRole("menuitem", { name: "Edit settings" }).click();
    await expect(availability.getByLabel("Closes", { exact: true })).toHaveValue("2026-01-01T09:00");
    await availability.getByRole("button", { name: "Cancel", exact: true }).click();

    const refused = respondent.waitForResponse(
      (response) =>
        response.url().endsWith(`/forms/${form.placement.id}/submissions`) && response.request().method() === "POST",
    );
    await respondent.getByRole("button", { name: "Submit response" }).click();
    expect((await refused).status()).toBe(409);
    await expect(respondent.getByRole("alert")).toContainText("closed");
    await expect(respondent.getByLabel("Your feedback")).toHaveValue("An answer prepared while the form was open");
    await respondent.reload();
    await expect(respondent.getByText("This form is closed", { exact: true })).toBeVisible();
    await expect(respondent.getByRole("button", { name: "Submit response" })).toHaveCount(0);
  } finally {
    await respondentContext.close();
  }
});
