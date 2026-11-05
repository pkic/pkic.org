import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { runRowAction } from "./helpers/data-table";
import { inspectPromotionExport } from "./helpers/promotion-export-evidence";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import {
  sessionAppearanceChoicesSchema,
  sessionHistoryCorrectionSchema,
} from "../../assets/shared/schemas/event-session-history";
import {
  promotionFormatSchema,
  promotionKitSaveSchema,
  promotionKitSchema,
} from "../../assets/shared/schemas/event-promotion-kit";
import { apiErrorPayloadSchema } from "../../assets/shared/schemas/api-common";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";

const slug = "pqc-conference-amsterdam-nl";
const agendaApi = `/api/v1/events/${slug}/agenda`;

function protectedArtifactHeaders(response: APIResponse) {
  const headers = response.headers();
  const directives = (headers["cache-control"] ?? "").split(",").map((value) => value.trim().toLowerCase());
  expect(directives).toContain("no-store");
  expect(directives).toContain("max-age=0");
  expect(directives).not.toContain("public");
  return {
    cacheControl: headers["cache-control"],
    contentType: headers["content-type"],
    contentDisposition: headers["content-disposition"],
    robotsTag: headers["x-robots-tag"],
    contentTypeOptions: headers["x-content-type-options"],
    referrerPolicy: headers["referrer-policy"],
  };
}

test("every delivered long-panel promotion export has complete evidence and refuses its stale revision", async ({
  page,
}, info) => {
  test.setTimeout(360_000);
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-preview"));
  const names = [
    "Alexandra Catherine van Example-Rivera, certificate lifecycle and migration engineering",
    "Benjamin Christopher Example-MacKenzie, cryptographic governance and assurance research",
    "Charlotte Dominique Example-Hernandez, infrastructure architecture, operational resilience",
  ];
  const affiliations = [
    `Synthetic Infrastructure Research Consortium and Independent Certificate Operations Laboratory ${randomUUID()}`,
    `Synthetic Cryptographic Policy Institute and Cross-Organization Migration Working Group ${randomUUID()}`,
    `Synthetic Resilience Engineering Foundation and Applied Trust Systems Research Center ${randomUUID()}`,
  ];
  const roles = [
    "Certificate lifecycle engineering director",
    "Cryptographic governance research lead",
    "Infrastructure resilience principal architect",
  ];
  const people = [];
  for (const [index, name] of names.entries()) {
    // Use the existing audited staff provisioning API. Immediate activation
    // is explicit; no test grants itself mailbox/domain authority or writes D1.
    const response = await page.request.post("/api/v1/organizations", {
      data: organizationCreateSchema.parse({
        name: affiliations[index],
        membershipCategory: "F",
        memberSince: "2026-01-15",
        identities: [{ name, email: `promotion-${randomUUID()}@example.test`, jobTitle: roles[index] }],
        activationReason: "Activate synthetic panel fixtures for reviewed promotion export inspection.",
      }),
    });
    expect(response.status(), await response.text()).toBe(201);
    const organization = organizationCreateResponseSchema.parse(await response.json()).organization;
    expect(organization.identities).toHaveLength(1);
    people.push({ id: organization.identities[0]!.userId, identityId: organization.identities[0]!.identityId });
  }
  expect(new Set(people.map((person) => person.id)).size).toBe(3);
  let snapshot = agendaSnapshotSchema.parse(await (await page.request.get(agendaApi)).json());
  const roomName = `Export review hall ${randomUUID()}`;
  const room = await page.request.post(`${agendaApi}/rooms`, {
    data: agendaRoomCreateSchema.parse({ expectedRevision: snapshot.revision, name: roomName, capacity: 100 }),
  });
  expect(room.status(), await room.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await room.json());
  const roomId = snapshot.rooms.find((item) => item.name === roomName)!.id;
  const title = `Building trustworthy cryptographic infrastructure across independent organizations: migration evidence, certificate lifecycle ownership and practical operational boundaries panel-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${agendaApi}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title,
      description: "A reviewed synthetic panel that tests full exported promotion content through canonical services.",
      startAt: "2026-12-02T15:00:00.000Z",
      endAt: "2026-12-02T16:00:00.000Z",
      roomId,
      speakerUserIds: people.map((person) => person.id),
      speakerPlacements: Object.fromEntries(
        people.map((person) => [person.id, { attendanceMode: "physical", roomId }]),
      ),
    }),
  });
  expect(created.status(), await created.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await created.json());
  const occurrence = snapshot.occurrences.find((item) => item.title === title)!;
  const choicesResponse = await page.request.get(
    `${agendaApi}/occurrences/${occurrence.id}/history/identities?limit=200&offset=0`,
  );
  expect(choicesResponse.status(), await choicesResponse.text()).toBe(200);
  const choices = sessionAppearanceChoicesSchema.parse(await choicesResponse.json());
  const appearances = people.map((person, index) => {
    const selected = choices.identities.find((item) => item.userId === person.id && item.id === person.identityId);
    expect(selected, "existing owned representation valid at the session date").toBeDefined();
    if (!selected) throw new Error("Do not invent a canonical panel representation");
    expect(selected.organizationName).toBe(affiliations[index]);
    expect(selected.jobTitle).toBe(roles[index]);
    return {
      userId: person.id,
      affiliations: [
        { identityId: selected.id, title: roles[index]!, organizationId: null, organizationName: affiliations[index]! },
      ],
      displayName: names[index]!,
      biography: "Reviewed synthetic appearance text for export inspection.",
      photoUrl: null,
      links: [],
      approvedAt: new Date().toISOString(),
    };
  });
  const history = await page.request.post(`${agendaApi}/occurrences/${occurrence.id}/history`, {
    data: sessionHistoryCorrectionSchema.parse({
      expectedRevision: snapshot.revision,
      history: { ...occurrence.history, appearances },
    }),
  });
  expect(history.status(), await history.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await history.json());
  const copy = {
    whyAttend:
      "Explore how independent organizations can preserve cryptographic trust while coordinating migration evidence, certificate ownership and operational recovery. Compare practical controls that make the transition observable and explainable.",
    takeaways: [
      "Identify the evidence needed to approve a cryptographic migration without losing certificate lifecycle accountability.",
      "Compare operational boundaries across independent organizations and preserve clear ownership when trust services change.",
      "Choose observable migration and recovery controls that teams can explain, audit and maintain together.",
    ],
    callToAction: "Register for this event",
    campaign: `export-${randomUUID()}`,
    approvedAt: new Date().toISOString(),
  };
  const kitApi = `${agendaApi}/occurrences/${occurrence.id}/promotion`;
  const copied = await page.request.post(kitApi, {
    data: promotionKitSaveSchema.parse({ expectedRevision: snapshot.revision, copy }),
  });
  expect(copied.status(), await copied.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await copied.json());
  const approved = await page.request.post(`${agendaApi}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
  });
  expect(approved.status(), await approved.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await approved.json());
  const frozen = snapshot.occurrences.find((item) => item.id === occurrence.id)!;
  expect(frozen.history?.appearances).toEqual(appearances);
  const eventResponse = await page.request.get(`/api/v1/events/${slug}`);
  expect(eventResponse.status(), await eventResponse.text()).toBe(200);
  const { event } = eventDetailResponseSchema.parse(await eventResponse.json());
  if (!("ownerGroupId" in event) || !event.ownerGroupId)
    throw new Error("The canonical event has no owning group management destination");
  await page.goto(
    `/portal/#/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}/agenda`,
  );
  await page
    .getByRole("tablist", { name: "Agenda views", exact: true })
    .getByRole("tab", { name: "Schedule", exact: true })
    .click();
  const sessions = page.getByRole("region", { name: "Event sessions", exact: true });
  await sessions.getByRole("searchbox", { name: "Search event sessions", exact: true }).fill(title);
  await sessions.getByRole("button", { name: "Search event sessions", exact: true }).click();
  const row = sessions
    .getByRole("table", { name: "Event sessions", exact: true })
    .getByRole("row")
    .filter({ has: page.getByText(title, { exact: true }) });
  await runRowAction(page, row, "Speaker promotion kit");
  await page.getByRole("button", { name: "Sharing actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Prepare kits for all speakers", exact: true }).click();
  const bulk = page.getByRole("dialog", { name: "Prepare speaker promotion kits", exact: true });
  await expect(bulk).toBeVisible();
  await page.goBack();
  await expect(bulk).not.toBeVisible();
  await page.goForward();
  await expect(bulk).toBeVisible();
  await bulk.getByRole("button", { name: "Close bulk promotion preparation", exact: true }).click();
  await expect(bulk).not.toBeVisible();
  await page.getByRole("button", { name: "Sharing actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit shared promotion copy", exact: true }).click();
  const sharedCopy = page.getByRole("dialog", { name: "Shared promotion copy", exact: true });
  await expect(sharedCopy).toBeVisible();
  await page.goBack();
  await expect(sharedCopy).not.toBeVisible();
  await page.goForward();
  await expect(sharedCopy).toBeVisible();
  await sharedCopy.getByRole("button", { name: "Close shared promotion copy", exact: true }).click();
  await expect(sharedCopy).not.toBeVisible();
  await page.getByRole("button", { name: "Customize tall post", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Personalize promotion materials", exact: true });
  const shortDescription = editor.getByRole("textbox", { name: "Your short description", exact: true });
  const previousDescription = await shortDescription.inputValue();
  await shortDescription.fill("Keep the personal draft through browser Back and Forward.");
  await page.goBack();
  await expect(editor).not.toBeVisible();
  await page.goForward();
  await expect(shortDescription).toHaveValue("Keep the personal draft through browser Back and Forward.");
  await shortDescription.fill(previousDescription);
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 375, 812],
  ] as const) {
    await page.setViewportSize({ width, height });
    await editor.getByLabel("Session content", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`promotion-editor-${device}.png`) });
  }

  await page
    .getByRole("checkbox", { name: "Print option Include a QR code for print or a second screen", exact: true })
    .check();
  await page.getByRole("button", { name: "Save my materials", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Personalize promotion materials", exact: true })).toHaveCount(0);
  const kitResponse = await page.request.get(kitApi);
  expect(kitResponse.status(), await kitResponse.text()).toBe(200);
  const kit = promotionKitSchema.parse(await kitResponse.json());
  expect(kit.publishedRevision).toBe(snapshot.publishedRevision);
  expect(kit.formats).toEqual(promotionFormatSchema.options);
  const registration = new URL(kit.registrationUrl);
  if (!kit.sessionUrl) throw new Error("A public event's approved session kit links its session page");
  const session = new URL(kit.sessionUrl);
  // The readable address issued from the approved title; the ID address redirects to it.
  expect(session.pathname).toMatch(new RegExp(`^/events/${slug}/sessions/[a-z0-9-]+/$`));
  expect(session.pathname).not.toContain(occurrence.id);
  expect(registration.origin).toBe(session.origin);
  expect(registration.pathname.startsWith("/r/") || registration.pathname.includes(`/${slug}/register/`)).toBe(true);
  for (const target of [registration, session]) {
    expect([...target.searchParams.keys()].some((key) => /token|manage|calendar|invite|signature/iu.test(key))).toBe(
      false,
    );
  }
  const directory = info.outputPath("promotion-exports");
  await mkdir(directory, { recursive: true });
  const records = [];
  const urls = [];
  const expectedPdfText = [title, ...copy.takeaways, ...names, ...affiliations, ...roles];
  const labels = {
    portrait: "tall post (JPEG)",
    square: "square post (JPEG)",
    landscape: "wide post (JPEG)",
    carousel: "carousel (PDF)",
  };
  await expect(page.locator(".pk-promotion-tile img")).toHaveCount(4);
  await expect
    .poll(() =>
      page
        .locator(".pk-promotion-tile img")
        .evaluateAll((images) =>
          images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 375, 812],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.locator(".pk-promotion-gallery").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`promotion-gallery-${device}.png`) });
    const enlarge = page.getByRole("button", { name: "Enlarge tall post", exact: true });
    await enlarge.click();
    await expect(page.getByRole("dialog", { name: "Tall post", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`promotion-enlarged-${device}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Tall post", exact: true })).toHaveCount(0);
    await expect(enlarge).toBeFocused();
  }
  const kitBeforeDownload = promotionKitSchema.parse(await (await page.request.get(kitApi)).json());
  expect(kitBeforeDownload.artifacts).toHaveLength(0);
  for (const format of promotionFormatSchema.options) {
    const action = page.getByRole("button", { name: `Download ${labels[format]}`, exact: true });
    await expect(action).toBeEnabled();
    const completed = page.waitForEvent("download", { timeout: 120_000 });
    await action.click();
    const downloaded = await completed;
    const filename = downloaded.suggestedFilename();
    expect(filename).toMatch(new RegExp(`^promotion-${format}\\.(pdf|jpg|zip)$`));
    const file = join(directory, filename);
    await downloaded.saveAs(file);
    const contentType = filename.endsWith(".pdf")
      ? "application/pdf"
      : filename.endsWith(".zip")
        ? "application/zip"
        : "image/jpeg";
    const evidence = await inspectPromotionExport({
      directory: join(directory, format),
      format,
      contentType,
      bytes: await readFile(file),
      registrationUrl: kit.registrationUrl,
      expectedPdfText,
    });
    records.push({ publishedRevision: kit.publishedRevision, templateVersion: kit.templateVersion, ...evidence });
    urls.push(
      `${kitApi}/artifact?${new URLSearchParams({ format, revision: String(kit.publishedRevision), fingerprint: kit.fingerprint!, representation: "artwork" })}`,
    );
  }
  expect(records.find((record) => record.format === "landscape")!.pageCount).toBeGreaterThan(1);
  expect(records.find((record) => record.format === "carousel")!.pageCount).toBeGreaterThan(4);
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 375, 812],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: join(directory, `kit-${device}.png`), fullPage: true });
  }
  const previewUrl = urls[0]!;
  const manifest = {
    eventSlug: slug,
    occurrenceId: occurrence.id,
    approvedAt: snapshot.approvedAt,
    kit,
    appearances: frozen.history?.appearances,
    copy: frozen.promotionCopy,
    records,
    visualReview:
      "pending: inspect every full-size and phone file; automated assertions are not human visual acceptance",
  };
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await info.attach("all-promotion-export-evidence", { path: manifestPath, contentType: "application/json" });
  const correction = await page.request.patch(`${agendaApi}/occurrences/${occurrence.id}`, {
    data: agendaOccurrencePatchSchema.parse({ expectedRevision: snapshot.revision, title: `${title} · revised` }),
  });
  expect(correction.status(), await correction.text()).toBe(200);
  const corrected = agendaSnapshotSchema.parse(await correction.json());
  const republished = await page.request.post(`${agendaApi}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: corrected.revision }),
  });
  expect(republished.status(), await republished.text()).toBe(200);
  const current = agendaSnapshotSchema.parse(await republished.json());
  for (const url of [...urls, previewUrl]) {
    const stale = await page.request.get(url);
    expect(stale.status(), await stale.text()).toBe(409);
    expect(apiErrorPayloadSchema.parse(await stale.json()).error.code).toBe("PROMOTION_ARTIFACT_STALE");
  }
  const freshResponse = await page.request.get(kitApi);
  expect(freshResponse.status(), await freshResponse.text()).toBe(200);
  const fresh = promotionKitSchema.parse(await freshResponse.json());
  expect(fresh.publishedRevision).toBe(current.publishedRevision);
  expect(fresh.publishedRevision).toBeGreaterThan(kit.publishedRevision);
  expect(fresh.registrationUrl).toBe(kit.registrationUrl);
  expect(fresh.metrics.clicks).toBe(0);
  expect(fresh.metrics.confirmedRegistrations).toBe(0);
  const freshUrl = `${kitApi}/artifact`;
  const freshArtifact = await page.request.post(freshUrl, {
    data: {
      fingerprint: fresh.fingerprint,
      publishedRevision: fresh.publishedRevision,
      compositionRevision: fresh.compositionRevision,
    },
  });
  expect(freshArtifact.status(), await freshArtifact.text()).toBe(200);
  const freshResponseHeaders = protectedArtifactHeaders(freshArtifact);
  const freshEvidence = await inspectPromotionExport({
    directory: join(directory, "fresh-carousel"),
    format: "carousel",
    contentType: freshArtifact.headers()["content-type"]!,
    bytes: await freshArtifact.body(),
    registrationUrl: fresh.registrationUrl,
    expectedPdfText: [`${title} · revised`, ...expectedPdfText.slice(1)],
  });
  await writeFile(
    join(directory, "stale-refusals.json"),
    JSON.stringify(
      {
        previousRevision: kit.publishedRevision,
        currentRevision: fresh.publishedRevision,
        urls: [...urls, previewUrl],
        status: 409,
        code: "PROMOTION_ARTIFACT_STALE",
        freshExport: {
          url: new URL(freshUrl, page.url()).href,
          publishedRevision: fresh.publishedRevision,
          responseHeaders: freshResponseHeaders,
          ...freshEvidence,
        },
      },
      null,
      2,
    ),
  );
});
