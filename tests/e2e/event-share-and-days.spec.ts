import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { eventParticipantRecordPath } from "../../assets/ts/member-flows/portal/sections/events/event-participant-paths";
import { myProfileUpdateSchema } from "../../assets/shared/schemas/me";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { identityCreateSchema, identityMutationResponseSchema } from "../../assets/shared/schemas/identity";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { registrationManageSchema } from "../../assets/shared/schemas/registration";
import { createRegistrationEvent, registerStateAttendee } from "./helpers/participation-state-fixture";
import { signInToPortal } from "./helpers/portal-auth";
import { waitForCapturedEmail } from "./helpers/sendgrid";

// Real session, registration, invitation endpoint, and outbox; all data belongs to this scenario.
test("attendees invite colleagues and confirm a seat release from one day picker", async ({ page }, info) => {
  const email = e2eAdminEmail("promotion-registration-attribution");
  await signInToPortal(page, email);
  const profile = await page.request.patch("/api/v1/users/current", {
    data: myProfileUpdateSchema.parse({ firstName: "Synthetic", lastName: "Attendee" }),
  });
  expect(profile.status(), await profile.text()).toBe(200);
  const attendanceOptions = [
    { value: "in_person", label: "In person", accessMode: "physical" as const, capacity: 20 },
    { value: "virtual", label: "Online", accessMode: "remote" as const },
    { value: "on_demand", label: "On demand", accessMode: "none" as const },
  ];
  const fixture = await createRegistrationEvent(page, "share-and-days", [
    { date: "2027-09-10", startTime: "09:00", endTime: "17:00", attendanceOptions },
    { date: "2027-09-11", startTime: "09:00", endTime: "17:00", attendanceOptions },
  ]);
  const actor = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
  const organization = await page.request.post("/api/v1/organizations", {
    data: organizationCreateSchema.parse({ name: `Synthetic Invitation Services ${crypto.randomUUID()}` }),
  });
  expect(organization.status(), await organization.text()).toBe(201);
  const organizationId = organizationCreateResponseSchema.parse(await organization.json()).organization.id;
  const represented = await page.request.post(`/api/v1/organizations/${organizationId}/identities`, {
    data: identityCreateSchema.parse({
      userReference: "existing_user",
      userId: actor.identity.id,
      jobTitle: "Conference attendee",
      activation: { mode: "immediate", reason: "Synthetic colleague invitation fixture" },
    }),
  });
  expect(represented.status(), await represented.text()).toBe(201);
  const identityId = identityMutationResponseSchema.parse(await represented.json()).identityId;
  await registerStateAttendee(page, fixture, email, { staticRelease: false, identityId });
  const response = await page.request.get(`/api/v1/events/${fixture.slug}`);
  const detail = eventDetailResponseSchema.parse(await response.json()).event;
  const registrationId = detail.participation!.registrationId!;
  const base = `/portal/#/events/${fixture.slug}`;
  await page.goto(base);
  await expect(page.getByRole("button", { name: "Invite a colleague", exact: true })).toBeVisible();
  await page.goto(`${base}/promotion`);
  await expect(page.getByRole("heading", { name: "Share & Invite", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Share on LinkedIn", exact: true })).toBeVisible();
  const invite = page.getByRole("button", { name: "Invite a colleague", exact: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(invite).toBeVisible();
    await page.screenshot({ path: info.outputPath(`share-${width}.png`), fullPage: true });
    await invite.click();
    const dialog = page.getByRole("dialog", { name: "Invite a colleague", exact: true });
    await expect(dialog.getByLabel(/^Invite 1 email address/)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`invite-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(invite).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await invite.click();
  const dialog = page.getByRole("dialog", { name: "Invite a colleague", exact: true });
  await dialog.getByRole("button", { name: "Send invites", exact: true }).click();
  await expect(dialog.getByLabel(/^Invite 1 email address/)).toHaveAttribute("aria-invalid", "true");
  const colleague = `colleague-${crypto.randomUUID()}@synthetic-invitation.test`;
  await dialog.getByLabel(/^Invite 1 email address/).fill(colleague);
  await dialog.getByRole("button", { name: "Send invites", exact: true }).click();
  await expect(dialog).toContainText("Queued 1 invitation");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await waitForCapturedEmail(colleague, "invited to");

  await page.goto(
    `/portal/#${eventParticipantRecordPath(fixture.slug, "registration", registrationId)}?day=2027-09-11`,
  );
  const days = page.getByRole("region", { name: "Your days", exact: true });
  await expect(days.getByRole("button", { name: "Save my days", exact: true })).toBeVisible();
  await expect(days.getByRole("radio", { name: "In person — Workshop day 2", exact: true })).toBeFocused();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: info.outputPath(`days-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await days.getByRole("radio", { name: "On demand — Workshop day 2", exact: true }).check();
  await days.getByRole("button", { name: "Save my days", exact: true }).click();
  const release = page.getByRole("alertdialog");
  await expect(release).toContainText("waiting list");
  await page.screenshot({ path: info.outputPath("release-375.png"), fullPage: true });
  await release.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(days.getByRole("radio", { name: "On demand — Workshop day 2", exact: true })).toBeChecked();
  await days.getByRole("button", { name: "Save my days", exact: true }).click();
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/v1/registrations/${registrationId}`,
  );
  await release.getByRole("button", { name: "Release seats and save", exact: true }).click();
  const updated = await saved;
  expect(updated.status()).toBe(200);
  expect(registrationManageSchema.parse(updated.request().postDataJSON()).dayAttendance).toEqual([
    { dayDate: "2027-09-10", attendanceType: "in_person" },
    { dayDate: "2027-09-11", attendanceType: "on_demand" },
  ]);
  await expect(days.getByRole("button", { name: "Change my days", exact: true })).toBeVisible();
  await expect(days.getByRole("button")).toHaveCount(1);
  await page.reload();
  await expect(days).toContainText("On demand");
});
