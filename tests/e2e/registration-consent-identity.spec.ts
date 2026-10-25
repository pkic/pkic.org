/** @covers event.3.2.b */
import { expect, test } from "@playwright/test";
import { registerInBrowser } from "./helpers/registration";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../../assets/shared/schemas/registration";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { userDetailResponseSchema, usersListResponseSchema } from "../../assets/shared/schemas/user-management";
import { userParticipationResponseSchema } from "../../assets/shared/schemas/user-participation";
import {
  groupMailingListCreateSchema,
  mailingListResponseSchema,
  mailingListSubscribersResponseSchema,
} from "../../assets/shared/schemas/mailing-lists";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { createMember } from "./helpers/member-provisioning";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

test("verified approved-domain registration affiliates once and an organization identity can be selected for the event", async ({
  page,
  browser,
}, testInfo) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  const representative = await createMember(page, { organizationName: "Summit Trust Services" });
  const owner = userDetailResponseSchema.parse(
    await (await page.request.get(`/api/v1/users/${representative.userId}`)).json(),
  );
  const organizationName = owner.user.identities[0].organizationName!;
  const email = `event-${Date.now()}@${representative.email.split("@")[1]}`;
  const listResponse = await page.request.post("/api/v1/groups/pkic/mailing-lists", {
    data: groupMailingListCreateSchema.parse({
      email: `consent-${Date.now()}@lists.example.test`,
      label: "Consent verification",
      purpose: "custom",
      subscriptionDefault: "group_members",
      postingPolicy: "subscribers",
      moderationPolicy: "moderated",
      active: true,
    }),
  });
  expect(listResponse.status(), await listResponse.text()).toBe(201);
  const listId = mailingListResponseSchema.parse(await listResponse.json()).mailingList.id;
  const subscribers = async () =>
    mailingListSubscribersResponseSchema.parse(
      await (
        await page.request.get(`/api/v1/groups/pkic/mailing-lists/${listId}/subscribers?q=${encodeURIComponent(email)}`)
      ).json(),
    );
  const attendeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const attendee = await attendeeContext.newPage();
  try {
    const since = await capturedEmailCount();
    const initial = await registerInBrowser(attendee, email);
    expect(initial.request.identityId).toBeUndefined();
    // Verified first, so the registration is final when submitted. The address is on the representative
    // organization's own domain, which already decides: no organization is asked.
    expect(initial.result.status).toBe("registered");
    await expect(attendee.getByRole("heading", { name: /You're registered/i })).toBeVisible();
    const confirmedEmail = await waitForCapturedEmail(email, "registration is confirmed", { since });
    const manageUrl = extractEmailUrl(confirmedEmail, "/register/manage/");
    const users = usersListResponseSchema.parse(
      await (await page.request.get(`/api/v1/users?q=${encodeURIComponent(email)}`)).json(),
    );
    const userId = users.users.find((user) => user.email === email)!.id;
    const detail = userDetailResponseSchema.parse(await (await page.request.get(`/api/v1/users/${userId}`)).json());
    // The approved work domain adds one organization identity alongside the personal identity.
    expect(detail.user.identities).toEqual([
      expect.objectContaining({ organizationId: null, organizationName: null, memberId: null }),
      expect.objectContaining({ organizationName, status: "active" }),
    ]);
    const participation = userParticipationResponseSchema.parse(
      await (await page.request.get(`/api/v1/users/${userId}/participation`)).json(),
    );
    expect(participation.participation.summary.groupCount).toBeGreaterThan(0);
    expect((await subscribers()).subscribers).toMatchObject([{ subscribed: true }]);
    await attendee.screenshot({
      path: testInfo.outputPath("event-confirmed-with-domain-affiliation.png"),
      fullPage: true,
    });

    // An affiliated member receives sign-in guidance, not a new join capability.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sinceJoin = await capturedEmailCount();
      await attendee.goto("/join/");
      await attendee.getByLabel(EMAIL_FIRST_COPY.join.work.label).fill(email);
      await attendee.getByRole("button", { name: EMAIL_FIRST_COPY.join.work.action, exact: true }).click();
      await expect(attendee.getByText("Check your email", { exact: true })).toBeVisible();
      const joinEmail = await waitForCapturedEmail(email, "already have PKI Consortium member access", {
        since: sinceJoin,
      });
      expect(new URL(extractEmailUrl(joinEmail, "/portal/")).pathname).toBe("/portal/");
    }
    await signInToPortal(attendee, email, { continueAs: organizationName });
    await expect(attendee.getByRole("navigation", { name: "Portal navigation" })).toBeVisible();
    // Joining again reuses the automatically created organization identity.
    const activeIdentities = async () =>
      identitiesListResponseSchema.parse(
        await (await attendee.request.get("/api/v1/users/current/identities?active=true")).json(),
      ).identities;
    const joined = await activeIdentities();
    expect(joined.filter((entry) => entry.organizationId === null)).toHaveLength(1);
    const organizationIdentities = joined.filter((entry) => entry.organizationId !== null);
    expect(organizationIdentities).toHaveLength(1);
    expect(organizationIdentities[0]!.organizationName).toBe(organizationName);
    expect(organizationIdentities[0]!.id).toBe(
      detail.user.identities.find((identity) => identity.organizationId !== null)!.identityId,
    );
    expect((await subscribers()).subscribers).toMatchObject([{ subscribed: true }]);
    await attendee.goto(manageUrl);
    await attendee.getByRole("button", { name: "Cancel my registration…", exact: true }).click();
    await acceptConfirmDialog(attendee, "Cancel registration");
    await expect(attendee.getByRole("heading", { name: "Registration cancelled", exact: true })).toBeVisible();
    const sinceSelected = await capturedEmailCount();
    const selected = await registerInBrowser(attendee, email, organizationName);
    expect(selected.request.identityId).toBe(organizationIdentities[0]!.id);
    expect(selected.result.registrationId).toBe(initial.result.registrationId);
    expect(selected.result.status).toBe("registered");
    await expect(attendee.getByRole("heading", { name: /You're registered/i })).toBeVisible();
    const selectedEmail = await waitForCapturedEmail(email, "registration is confirmed", { since: sinceSelected });
    await attendee.goto(extractEmailUrl(selectedEmail, "/register/manage/"));
    await attendee.getByRole("button", { name: "Change representation", exact: true }).click();
    const changeIdentity = attendee.getByRole("dialog", { name: "Change representation", exact: true });
    await changeIdentity.getByRole("combobox", { name: "Representation", exact: true }).click();
    await attendee.getByRole("option").filter({ hasText: "Personal" }).click();
    for (const [width, height, device] of [
      [1280, 900, "desktop"],
      [375, 812, "phone"],
    ] as const) {
      await attendee.setViewportSize({ width, height });
      await attendee.screenshot({ path: testInfo.outputPath(`public-update-identity-${device}.png`) });
    }
    await changeIdentity.getByRole("button", { name: "Add identity", exact: true }).click();
    const addIdentity = attendee.getByRole("dialog", { name: "Add identity", exact: true });
    await expect(addIdentity.getByRole("textbox", { name: /^Representation email/ })).toBeVisible();
    await attendee.screenshot({ path: testInfo.outputPath("public-update-add-identity-phone.png") });
    await addIdentity.getByRole("button", { name: "Cancel", exact: true }).click();
    await changeIdentity.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(changeIdentity).not.toBeVisible();
    await attendee.reload();
    await attendee.getByRole("button", { name: "Change representation", exact: true }).click();
    await expect(changeIdentity.getByRole("combobox", { name: "Representation", exact: true })).toContainText(
      "Personal",
    );
    await changeIdentity.getByRole("combobox", { name: "Representation", exact: true }).click();
    await attendee.getByRole("option").filter({ hasText: organizationName }).click();
    await changeIdentity.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(changeIdentity).not.toBeVisible();
    // Profile edits preserve the independently selected registration representation.
    await expect(attendee.getByRole("definition").filter({ hasText: organizationName })).toBeVisible();
    await attendee.getByRole("button", { name: "Edit details", exact: true }).click();
    await expect(attendee.getByRole("textbox", { name: "Organization", exact: true })).toHaveCount(0);
    await expect(attendee.getByRole("link", { name: "Manage identities", exact: true })).toBeVisible();
    await expect(attendee.getByLabel("Country", { exact: true })).toHaveValue("US");
    await attendee.getByLabel("Country", { exact: true }).selectOption("CA");
    await attendee.goBack();
    await expect(attendee.getByRole("button", { name: "Edit details", exact: true })).toBeVisible();
    await attendee.goForward();
    await expect(attendee.getByLabel("Country", { exact: true })).toHaveValue("CA");
    const savedResponse = attendee.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/v1/registrations/access/") &&
        response.request().method() === "PATCH",
    );
    await attendee.getByRole("button", { name: "Save changes", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status(), await saved.text()).toBe(200);
    expect(registrationManageSchema.parse(saved.request().postDataJSON())).toMatchObject({
      action: "update",
      customAnswers: { country: "CA" },
    });
    registrationManageUpdateResponseSchema.parse(await saved.json());
    await expect(attendee.getByRole("heading", { name: "Changes saved", exact: true })).toBeVisible();
    await attendee.reload();
    await attendee.getByRole("button", { name: "Edit details", exact: true }).click();
    await expect(attendee.getByLabel("Country", { exact: true })).toHaveValue("CA");
    const badge = attendee.locator("[data-og-badge-img]");
    await expect(badge).toHaveAttribute("src", /[?&]v=/);
    await expect
      .poll(() => badge.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
      .toBe(true);
    await badge.screenshot({ path: testInfo.outputPath("selected-identity-badge.png") });
    await attendee.screenshot({ path: testInfo.outputPath("registration-selected-identity.png"), fullPage: true });
    await attendee.setViewportSize({ width: 375, height: 812 });
    await attendee.screenshot({
      path: testInfo.outputPath("registration-selected-identity-phone.png"),
      fullPage: true,
    });
  } finally {
    await attendeeContext.close();
  }
});
