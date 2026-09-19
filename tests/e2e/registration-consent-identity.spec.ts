/** @covers event.3.2.b */
import { expect, test } from "@playwright/test";
import { registerInBrowser } from "./helpers/registration";
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

test("event confirmation joins nobody; explicit organization consent joins once and an identity can then be selected for the event", async ({
  page,
  browser,
}, testInfo) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  const representative = await createMember(page);
  const owner = userDetailResponseSchema.parse(
    await (await page.request.get(`/api/v1/users/${representative.userId}`)).json(),
  );
  const organizationName = owner.user.identities[0].organizationName!;
  const email = `event-${Date.now()}@${representative.email.split("@")[1]}`;
  const listResponse = await page.request.post("/api/v1/groups/all-members/mailing-lists", {
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
        await page.request.get(
          `/api/v1/groups/all-members/mailing-lists/${listId}/subscribers?q=${encodeURIComponent(email)}`,
        )
      ).json(),
    );
  const attendeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const attendee = await attendeeContext.newPage();
  try {
    const since = await capturedEmailCount();
    const initial = await registerInBrowser(attendee, email);
    expect(initial.request.identityId).toBeUndefined();
    expect(initial.result.status).toBe("pending_email_confirmation");
    const confirmEmail = await waitForCapturedEmail(email, "Confirm your registration", { since });
    await attendee.goto(extractEmailUrl(confirmEmail, "/register/confirm"));
    await attendee.getByRole("button", { name: /Confirm my registration/i }).click();
    await expect(attendee.getByRole("heading", { name: /You're registered/i })).toBeVisible();
    const confirmedEmail = await waitForCapturedEmail(email, "registration is confirmed", { since });
    const manageUrl = extractEmailUrl(confirmedEmail, "/register/manage/");
    const users = usersListResponseSchema.parse(
      await (await page.request.get(`/api/v1/users?q=${encodeURIComponent(email)}`)).json(),
    );
    const userId = users.users.find((user) => user.email === email)!.id;
    const detail = userDetailResponseSchema.parse(await (await page.request.get(`/api/v1/users/${userId}`)).json());
    expect(detail.user.identities).toEqual([]);
    const participation = userParticipationResponseSchema.parse(
      await (await page.request.get(`/api/v1/users/${userId}/participation`)).json(),
    );
    expect(participation.participation.summary.groupCount).toBe(0);
    expect((await subscribers()).subscribers.filter((subscriber) => subscriber.subscribed)).toEqual([]);
    await attendee.screenshot({ path: testInfo.outputPath("event-confirmed-without-membership.png"), fullPage: true });

    const sinceJoin = await capturedEmailCount();
    await attendee.goto("/join/");
    await attendee.getByLabel("Yes — I am employed by or own an organization").check();
    await attendee.getByLabel("Your official work or organization email address").fill(email);
    await attendee.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(attendee.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
    const joinEmail = await waitForCapturedEmail(email, "Verify your email address", { since: sinceJoin });
    const joinUrl = extractEmailUrl(joinEmail, "/join/");
    const joinToken = new URLSearchParams(new URL(joinUrl).hash.slice(1)).get("verify")!;
    await attendee.goto(joinUrl);
    await expect(attendee.getByRole("heading", { name: "Organization access is ready", exact: true })).toBeVisible();
    await attendee.getByRole("link", { name: "Continue to the portal", exact: true }).click();
    await expect(attendee.getByRole("complementary", { name: "Portal navigation" })).toBeVisible();
    const identities = identitiesListResponseSchema.parse(
      await (await attendee.request.get("/api/v1/users/current/identities?active=true")).json(),
    );
    expect(identities.identities).toHaveLength(1);
    expect(identities.identities[0].organizationName).toBe(organizationName);
    expect((await subscribers()).subscribers).toMatchObject([{ subscribed: true }]);
    const replay = await attendee.request.post("/api/v1/members/join/verify", { data: { token: joinToken } });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ status: "already_member" });
    expect(replay.headers()["set-cookie"]).toBeUndefined();
    expect(
      identitiesListResponseSchema.parse(
        await (await attendee.request.get("/api/v1/users/current/identities?active=true")).json(),
      ).identities,
    ).toHaveLength(1);

    await attendee.goto(manageUrl);
    await attendee.getByRole("button", { name: "Cancel registration", exact: true }).click();
    await attendee.getByRole("button", { name: "Yes, cancel my registration", exact: true }).click();
    await expect(attendee.getByRole("heading", { name: "Registration cancelled", exact: true })).toBeVisible();
    const sinceSelected = await capturedEmailCount();
    const selected = await registerInBrowser(attendee, email, organizationName);
    expect(selected.request.identityId).toBe(identities.identities[0].id);
    expect(selected.result.registrationId).toBe(initial.result.registrationId);
    expect(selected.result.status).toBe("registered");
    await expect(attendee.getByRole("heading", { name: /You're registered/i })).toBeVisible();
    const selectedEmail = await waitForCapturedEmail(email, "registration is confirmed", { since: sinceSelected });
    await attendee.goto(extractEmailUrl(selectedEmail, "/register/manage/"));
    await expect(attendee.getByLabel("Organization", { exact: true })).toHaveValue(organizationName);
    await expect(attendee.getByLabel("Organization", { exact: true })).toHaveAttribute("readonly", "");
    const badge = attendee.locator("[data-og-badge-img]");
    await expect(badge).toHaveAttribute("src", /[?]v=/);
    await expect
      .poll(() => badge.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
      .toBe(true);
    await badge.screenshot({ path: testInfo.outputPath("selected-identity-badge.png") });
    await attendee.screenshot({ path: testInfo.outputPath("registration-selected-identity.png"), fullPage: true });
    await attendee.setViewportSize({ width: 390, height: 844 });
    await attendee.screenshot({
      path: testInfo.outputPath("registration-selected-identity-phone.png"),
      fullPage: true,
    });
  } finally {
    await attendeeContext.close();
  }
});
