import { promotionCompositionSaveSchema } from "../../assets/shared/schemas/event-promotion-design";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import jsQR from "jsqr";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { apiErrorPayloadSchema } from "../../assets/shared/schemas/api-common";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { eventRegistrationDetailResponseSchema } from "../../assets/shared/schemas/event-registration-detail";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { promotionKitSaveSchema, promotionKitSchema } from "../../assets/shared/schemas/event-promotion-kit";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { userUpdateSchema } from "../../assets/shared/schemas/user-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { registerInBrowser } from "./helpers/registration";

const slug = "pqc-conference-amsterdam-nl";
const eventApi = `/api/v1/events/${slug}`;
const registrationPage = `/events/2026/${slug}/register/`;

/**
 * A person registering while signed in takes part as one of the identities they hold. Staff give
 * this person one the way a real organization does: by naming them as its representative.
 */
async function provisionRepresentative(staff: Page, email: string): Promise<string> {
  const organizationName = `Promotion Organization ${randomUUID().slice(0, 8)}`;
  const created = await staff.evaluate(
    async ({ organizationName, email }) => {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: organizationName,
          membershipCategory: "F",
          memberSince: "2026-01-15",
          identities: [{ name: "Promotion Representative", email, jobTitle: "Delegate" }],
          activationReason: "E2E: a representative to register for the event",
        }),
      });
      const body = (await response.json()) as { organization?: { identities?: Array<{ userId: string }> } };
      const userId = body.organization?.identities?.[0]?.userId;
      // The registration form asks a person without a name on file for one; the person has it already.
      const named = userId
        ? await fetch(`/api/v1/users/${userId}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ firstName: "Event", lastName: "Attendee" }),
          })
        : null;
      return { status: response.status, namedStatus: named?.status, body: JSON.stringify(body) };
    },
    { organizationName, email },
  );
  expect(created.status, created.body).toBe(201);
  expect(created.namedStatus, created.body).toBe(200);
  return organizationName;
}

async function capture(page: Page, info: TestInfo, label: string) {
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 375, 812],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (device === "phone" && label === "attendee-recovery")
      await page
        .getByText("Some sessions in your materials are no longer on the agenda.", { exact: false })
        .scrollIntoViewIfNeeded();
    if (device === "phone" && label === "attendee-promotion-menu")
      await page
        .getByRole("list", { name: "More event pages" })
        .getByRole("link", { name: "Share & Invite", exact: true })
        .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`${label}-${device}.png`),
      fullPage: device === "desktop" && (await page.getByRole("dialog").count()) === 0,
    });
  }
}

test("a rendered promotion QR preserves its referral through email sign-in and credits one confirmed registration", async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const ownerEmail = e2eAdminEmail("promotion-registration-attribution");
  await signInToPortal(page, ownerEmail);
  const ownerEventResponse = await page.request.get(eventApi);
  expect(ownerEventResponse.status()).toBe(200);
  const ownerEvent = eventDetailResponseSchema.parse(await ownerEventResponse.json());
  let ownerRegistrationId = ownerEvent.event.participation?.registrationId;
  if (!ownerRegistrationId) {
    const owner = await registerInBrowser(page, ownerEmail, await provisionRepresentative(page, ownerEmail));
    ownerRegistrationId = owner.result.registrationId;
  }
  const ownerDetailResponse = await page.request.get(`${eventApi}/registrations/${ownerRegistrationId}`);
  expect(ownerDetailResponse.status(), await ownerDetailResponse.text()).toBe(200);
  const ownerDetail = eventRegistrationDetailResponseSchema.parse(await ownerDetailResponse.json());
  expect(ownerDetail.registration.status).toBe("registered");

  const draftResponse = await page.request.get(`${eventApi}/agenda`);
  expect(draftResponse.status(), await draftResponse.text()).toBe(200);
  const draft = agendaSnapshotSchema.parse(await draftResponse.json());
  const title = `Planning a quantum-safe migration: workshop ${draft.occurrences.length + 1}`;
  const createdResponse = await page.request.post(`${eventApi}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: draft.revision,
      title,
      description: "A synthetic session for the real promotion referral journey.",
      startAt: "2026-12-01T08:00:00.000Z",
      endAt: "2026-12-01T09:00:00.000Z",
      roomId: null,
      speakerUserIds: [],
    }),
  });
  expect(createdResponse.status(), await createdResponse.text()).toBe(200);
  const created = agendaSnapshotSchema.parse(await createdResponse.json());
  const occurrence = created.occurrences.find((item) => item.title === title);
  if (!occurrence) throw new Error("The canonical occurrence was not created");
  const kitApi = `${eventApi}/agenda/occurrences/${occurrence.id}/promotion`;
  const campaign = `qr-${randomUUID()}`;
  const copyResponse = await page.request.post(kitApi, {
    data: promotionKitSaveSchema.parse({
      expectedApprovedAt: null,
      copy: {
        whyAttend: "Follow a real promotion link through verified email sign-in and event registration.",
        takeaways: ["Keep the canonical referral through sign-in", "Count confirmed registration once"],
        callToAction: "Register for this event",
        campaign,
        approvedAt: new Date().toISOString(),
      },
    }),
  });
  expect(copyResponse.status(), await copyResponse.text()).toBe(200);
  const reviewed = agendaSnapshotSchema.parse(await copyResponse.json());
  const publishedResponse = await page.request.post(`${eventApi}/agenda/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: reviewed.revision }),
  });
  expect(publishedResponse.status(), await publishedResponse.text()).toBe(200);
  const published = agendaSnapshotSchema.parse(await publishedResponse.json());
  expect(published.publishedRevision).toBe(published.revision);

  const eventResponse = await page.request.get(eventApi);
  expect(eventResponse.status(), await eventResponse.text()).toBe(200);
  const { event } = eventDetailResponseSchema.parse(await eventResponse.json());
  if (!("ownerGroupId" in event) || !event.ownerGroupId)
    throw new Error("The canonical event has no owning group management destination");
  await page.goto(
    `/portal/#/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}/agenda`,
  );
  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: title });
  await row.getByRole("button", { name: /actions/i }).click();
  await page.getByRole("menuitem", { name: "Speaker promotion kit", exact: true }).click();
  // Each file's own Customize action opens the one editor for the person's materials.
  await page.getByRole("button", { name: "Customize tall post", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Print option Include a QR code for print or a second screen", exact: true })
    .check();
  await page.getByRole("button", { name: "Save my materials", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Personalize promotion materials", exact: true })).toHaveCount(0);
  // The gallery renders each file's cover in the browser once the saved materials load.
  const preview = page.getByRole("img", { name: "Preview of your tall post", exact: true });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const previewUrl = await preview.getAttribute("src");
  if (!previewUrl?.startsWith("data:image/svg+xml;base64,"))
    throw new Error("The rendered promotion card has no inline artwork");
  const pixels = await sharp(Buffer.from(previewUrl.slice(previewUrl.indexOf(",") + 1), "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height);
  if (!decoded) throw new Error("The actual promotion card pixels contain no readable QR");
  const readKit = async () => {
    const response = await page.request.get(kitApi);
    expect(response.status(), await response.text()).toBe(200);
    return promotionKitSchema.parse(await response.json());
  };
  const kit = await readKit();
  // The carousel is the one file the server renders, through the same download the gallery offers.
  const downloading = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Download carousel (PDF)", exact: true }).click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe("promotion-carousel.pdf");
  const pdfBytes = await readFile(await downloaded.path());
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  await info.attach("downloaded-carousel.pdf", { body: pdfBytes, contentType: "application/pdf" });
  expect(kit.copy.campaign).toBe(campaign);
  const baseline = kit.metrics;
  expect(decoded.data).toBe(kit.registrationUrl);
  const destination = new URL(decoded.data);
  expect(destination.pathname).toMatch(/^\/r\/[A-Za-z0-9]+$/);
  expect(destination.search).toBe("");
  await page.getByRole("button", { name: "Customize tall post", exact: true }).click();
  await capture(page, info, "promotion-editor-layout");
  await page
    .getByLabel("Your short description", { exact: true })
    .fill("My reviewed description for sharing this session with my network.");
  await capture(page, info, "promotion-adjustments");
  await page.getByRole("button", { name: "Save my materials", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Personalize promotion materials", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Customize tall post", exact: true })).toBeVisible();
  const personalized = await readKit();
  expect(personalized.composition?.summary).toBe("My reviewed description for sharing this session with my network.");
  expect(personalized.registrationUrl).toBe(kit.registrationUrl);
  await capture(page, info, "promotion-qr");
  await page.getByRole("button", { name: "Sharing actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Prepare kits for all speakers", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Prepare speaker promotion kits", exact: true })).toBeVisible();
  await capture(page, info, "bulk-promotion-dialog");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // A separate browser context begins without the owner's cookie or tab storage.
  const visitorContext = await context.browser()!.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const visitor = await visitorContext.newPage();
    const clicked = visitor.waitForResponse((response) => new URL(response.url()).pathname === destination.pathname);
    await visitor.goto(decoded.data);
    expect((await clicked).status()).toBe(200);
    const code = destination.pathname.slice("/r/".length);
    await expect(visitor).toHaveURL(new RegExp(`/events/2026/${slug}/register/\\?`));
    expect(new URL(visitor.url()).searchParams.get("ref")).toBe(code);
    // Registration asks a signed-out visitor to sign in or start an account first.
    await expect(
      visitor.getByRole("region", { name: "Sign in", exact: true }).getByRole("button", { name: "Start registration" }),
    ).toBeVisible();
    await expect.poll(() => visitor.evaluate(() => sessionStorage.getItem("pkic_ref"))).toBe(code);
    await expect.poll(async () => (await readKit()).metrics.clicks).toBe(baseline.clicks + 1);
    await capture(visitor, info, "attributed-guest-entry");

    const visitorEmail = e2eAdminEmail("promotion-registration-visitor");
    const visitorOrganization = await provisionRepresentative(page, visitorEmail);
    await signInToPortal(visitor, visitorEmail);
    const sessionResponse = await visitor.request.get("/api/v1/auth/session");
    expect(sessionResponse.status(), await sessionResponse.text()).toBe(200);
    const session = userAuthSessionResponseSchema.parse(await sessionResponse.json());
    const profileResponse = await visitor.request.patch(`/api/v1/users/${session.identity.id}`, {
      data: userUpdateSchema.parse({ firstName: "Event", lastName: "Attendee" }),
    });
    expect(profileResponse.status(), await profileResponse.text()).toBe(200);
    await visitor.goto(registrationPage);
    expect(new URL(visitor.url()).search).toBe("");
    expect(await visitor.evaluate(() => sessionStorage.getItem("pkic_ref"))).toBe(code);
    const submitted = await registerInBrowser(visitor, visitorEmail, visitorOrganization, registrationPage);
    expect(submitted.request.referralCode).toBe(code);
    expect(submitted.request.sourceType).toBe("direct");
    expect(submitted.result.status).toBe("registered");
    expect(await visitor.evaluate(() => sessionStorage.getItem("pkic_ref"))).toBeNull();
    await expect
      .poll(async () => (await readKit()).metrics.confirmedRegistrations)
      .toBe(baseline.confirmedRegistrations + 1);
    const detailResponse = await page.request.get(`${eventApi}/registrations/${submitted.result.registrationId}`);
    expect(detailResponse.status(), await detailResponse.text()).toBe(200);
    const detail = eventRegistrationDetailResponseSchema.parse(await detailResponse.json());
    expect(detail.registration).toMatchObject({
      id: submitted.result.registrationId,
      user_id: session.identity.id,
      event_id: ownerDetail.registration.event_id,
      status: "registered",
    });
    expect(detail.registration.id).not.toBe(ownerRegistrationId);
    await visitor.goto(`/portal/#/events/${slug}/promotion`);
    // A registered attendee's materials open with the page; their first referral link is made as it loads.
    const attendeeMaterials = visitor.getByRole("region", { name: "Your attendee materials", exact: true });
    await attendeeMaterials.getByRole("button", { name: "Customize tall post", exact: true }).click();
    await expect(visitor.getByRole("dialog", { name: "Personalize promotion materials", exact: true })).toBeVisible();
    await expect(visitor.getByRole("button", { name: "Move cover down", exact: true })).toBeVisible();
    await capture(visitor, info, "attendee-promotion");

    // The existing registration policy refuses repeat intent without creating another conversion.
    const retry = await visitor.request.post(`${eventApi}/registrations`, {
      data: registrationCreateSchema.parse({ ...submitted.request, identityId: submitted.identityId }),
    });
    expect(retry.status(), await retry.text()).toBe(409);
    expect(apiErrorPayloadSchema.parse(await retry.json()).error.code).toBe("REGISTRATION_EXISTS");
    const afterRetry = await readKit();
    expect(afterRetry.registrationUrl).toBe(decoded.data);
    expect(afterRetry.copy.campaign).toBe(campaign);
    expect(afterRetry.metrics).toMatchObject({
      clicks: baseline.clicks + 1,
      confirmedRegistrations: baseline.confirmedRegistrations + 1,
    });
    await visitor.goto(registrationPage);
    await expect(visitor.locator("[data-registration-contact]")).toBeVisible();
    expect(await visitor.evaluate((value) => Object.values(sessionStorage).includes(value), code)).toBe(false);
  } finally {
    await visitorContext.close();
  }
});

test("attendees can recover promotion materials after a selected session is withdrawn", async ({ page }, info) => {
  test.setTimeout(120_000);
  const ownerEmail = e2eAdminEmail("promotion-registration-attribution");
  await signInToPortal(page, ownerEmail);
  const eventResponse = await page.request.get(eventApi);
  const event = eventDetailResponseSchema.parse(await eventResponse.json());
  if (!event.event.participation?.registrationId)
    await registerInBrowser(page, ownerEmail, await provisionRepresentative(page, ownerEmail));
  const agendaResponse = await page.request.get(`${eventApi}/agenda`);
  const agenda = agendaSnapshotSchema.parse(await agendaResponse.json());
  const title = `Withdrawn promotion selection ${randomUUID()}`;
  const createdResponse = await page.request.post(`${eventApi}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: agenda.revision,
      title,
      description: "A synthetic session used to verify promotion draft recovery.",
      startAt: "2026-12-01T08:00:00.000Z",
      endAt: "2026-12-01T09:00:00.000Z",
      roomId: null,
      speakerUserIds: [],
    }),
  });
  expect(createdResponse.status(), await createdResponse.text()).toBe(200);
  const created = agendaSnapshotSchema.parse(await createdResponse.json());
  const occurrence = created.occurrences.find((item) => item.title === title)!;
  const publishedResponse = await page.request.post(`${eventApi}/agenda/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: created.revision }),
  });
  expect(publishedResponse.status(), await publishedResponse.text()).toBe(200);
  const published = agendaSnapshotSchema.parse(await publishedResponse.json());
  const base = `${eventApi}/promotion`;
  let response = await page.request.get(base);
  if (response.status() === 409) response = await page.request.post(`${base}/referrals`, { data: {} });
  expect(response.status(), await response.text()).toBe(200);
  const kit = promotionKitSchema.parse(await response.json());
  const saved = await page.request.post(`${base}/composition`, {
    data: promotionCompositionSaveSchema.parse({
      expectedRevision: kit.compositionRevision,
      composition: { ...kit.composition, sessionIds: [occurrence.id] },
    }),
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const withdrawnResponse = await page.request.patch(`${eventApi}/agenda/occurrences/${occurrence.id}`, {
    data: agendaOccurrencePatchSchema.parse({ expectedRevision: published.revision, visibility: "private" }),
  });
  expect(withdrawnResponse.status(), await withdrawnResponse.text()).toBe(200);
  const withdrawn = agendaSnapshotSchema.parse(await withdrawnResponse.json());
  const republished = await page.request.post(`${eventApi}/agenda/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: withdrawn.revision }),
  });
  expect(republished.status(), await republished.text()).toBe(200);
  await page.goto(`/portal/#/events/${slug}/more`);
  const promotionLink = page
    .getByRole("list", { name: "More event pages" })
    .getByRole("link", { name: "Share & Invite", exact: true });
  await expect(promotionLink).toBeVisible();
  await capture(page, info, "attendee-promotion-menu");
  await promotionLink.click();
  const materials = page.getByRole("region", { name: "Your attendee materials", exact: true });
  const unavailable = materials.getByText("Some sessions in your materials are no longer on the agenda.", {
    exact: false,
  });
  const download = materials.getByRole("button", { name: "Download tall post (JPEG)", exact: true });
  await expect(unavailable).toBeVisible();
  await expect(download).toBeDisabled();
  await capture(page, info, "attendee-recovery");
  await materials.getByRole("button", { name: "Customize tall post", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Personalize promotion materials", exact: true });
  await expect(dialog).toBeVisible();
  await capture(page, info, "attendee-recovery-editor");
  await dialog.getByRole("button", { name: "Save my materials", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(unavailable).toBeHidden();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const fresh = promotionKitSchema.parse(await (await page.request.get(base)).json());
  expect(fresh.stale).toBe(false);
  expect(fresh.composition?.sessionIds).toEqual([]);
});
