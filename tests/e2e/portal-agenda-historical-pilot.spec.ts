import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../assets/shared/schemas/group-events";
import { agendaSnapshotSchema, agendaRoomCreateSchema } from "../../assets/shared/schemas/event-agenda";
import { agendaTransferSchema } from "../../assets/shared/schemas/event-agenda-transfer";
import { sessionPresentationVersionsSchema } from "../../assets/shared/schemas/session-presentation-versions";
import { USER_SESSION_COOKIE_NAME } from "../../functions/_lib/auth/session-cookies";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const source = "content/events/2023/post-quantum-cryptography-conference/index.md";
const execute = promisify(execFile);
test.use({ actionTimeout: 20_000 });
test("real Ottawa YAML archives all rows and offsets and uploads eight resumable local draft PDFs", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await signInAsE2eStaff(page, e2eAdminEmail("browser-presentation"));
  const slug = `historical-ottawa-pilot-${crypto.randomUUID().slice(0, 8)}`;
  const eventResponse = await page.request.post("/api/v1/groups/20000000-0000-4000-8000-000000000003/events", {
    data: groupEventCreateSchema.parse({
      slug,
      name: "Historical Ottawa source pilot",
      timezone: "America/Toronto",
      startsAt: "2023-03-03T13:30:00.000Z",
      endsAt: "2023-03-03T21:00:00.000Z",
      profileKey: "conference",
      registrationPolicy: "no_registration",
      visibility: "public",
      links: [],
    }),
  });
  expect(eventResponse.status(), await eventResponse.text()).toBe(201);
  const event = groupEventDetailResponseSchema.parse(await eventResponse.json()).event;
  const read = async () =>
    agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const roomResponse = await page.request.post(`/api/v1/events/${slug}/agenda/rooms`, {
    data: agendaRoomCreateSchema.parse({ expectedRevision: (await read()).revision, name: "Plenary", capacity: null }),
  });
  expect(roomResponse.ok(), await roomResponse.text()).toBe(true);
  const room = agendaSnapshotSchema.parse(await roomResponse.json()).rooms.find((row) => row.name === "Plenary")!;
  await mkdir(info.outputDir, { recursive: true });
  const mapping = info.outputPath("reviewed-local-mappings.json");
  const documentPath = info.outputPath("ottawa-agenda.json");
  await writeFile(
    mapping,
    JSON.stringify({
      event: { eventId: event.id, eventSlug: slug },
      roomIds: { plenary: room.id },
      archivePublicSource: true,
      publicBasePath: "/content-media/events/2023/post-quantum-cryptography-conference",
    }),
  );
  await execute(
    process.execPath,
    ["--experimental-strip-types", "scripts/prepare-agenda-import.mjs", source, mapping, documentPath],
    { timeout: 30000 },
  );
  const document = agendaTransferSchema.parse(JSON.parse(await readFile(documentPath, "utf8")));
  expect(document.occurrences).toHaveLength(14);
  expect(document.people.every((person) => person.canonicalUserId === null)).toBe(true);
  expect(document.occurrences.flatMap((row) => row.archive?.archivalCredits ?? [])).toHaveLength(17);
  const networking = document.occurrences.find((row) => row.fields.title === "Networking")!;
  expect(networking.archive!.archivalTiming!.endAt).toBeNull();
  const token = (await page.context().cookies()).find((cookie) => cookie.name === USER_SESSION_COOKIE_NAME)!.value;
  const options = { env: { ...process.env, PKIC_AGENDA_IMPORT_TOKEN: token }, timeout: 60000 };
  const baseUrl = new URL(page.url()).origin;
  const args = [
    "--experimental-strip-types",
    "scripts/import-agenda.mjs",
    "--base-url",
    baseUrl,
    "--event",
    slug,
    "--document",
    documentPath,
    "--acknowledge-inferred-timing",
    "--acknowledge-archive-representation",
  ];
  const review = await execute(process.execPath, args, options);
  expect(review.stdout).not.toContain(token);
  expect((await read()).occurrences).toHaveLength(0);
  await execute(process.execPath, [...args, "--apply"], options);
  const imported = await read();
  expect(imported.occurrences).toHaveLength(14);
  expect(imported.occurrences.every((row) => row.speakers.length === 0)).toBe(true);
  const unknown = imported.occurrences.find((row) => row.title === "Networking")!;
  expect([unknown.startAt, unknown.endAt]).toEqual([null, null]);
  expect(unknown.history!.archivalTiming!.startAt).toBe("2023-03-03T20:30:00.000Z");
  await execute(process.execPath, [...args, "--apply"], options);
  expect((await read()).occurrences.map((row) => row.id).sort()).toEqual(
    imported.occurrences.map((row) => row.id).sort(),
  );
  const exported = agendaTransferSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda/transfers/exports?limit=100`)).json(),
  );
  const presentations = document.occurrences.flatMap((row) =>
    row.media.filter((media) => media.kind === "presentation").map((media) => ({ row, media })),
  );
  expect(presentations).toHaveLength(8);
  const recordings = exported.occurrences
    .flatMap((row) => row.media.filter((media) => media.kind === "recording").map((media) => media.publicUrl))
    .sort();
  expect(recordings).toEqual(
    document.occurrences
      .flatMap((row) => row.media.filter((media) => media.kind === "recording").map((media) => media.publicUrl))
      .sort(),
  );
  const occurrences = Object.fromEntries(
    presentations.map(({ row, media }) => [
      media.authoredReference,
      exported.occurrences.find((item) => item.sourceKey === row.sourceKey)!.ref,
    ]),
  );
  const mediaMapping = info.outputPath("material-occurrences.json"),
    receipts = info.outputPath("material-receipts.json");
  await writeFile(mediaMapping, JSON.stringify(occurrences));
  const mediaArgs = [
    "--experimental-strip-types",
    "scripts/import-agenda-media.mjs",
    "--report",
    `${documentPath}.report.json`,
    "--mappings",
    mediaMapping,
    "--repository-root",
    process.cwd(),
    "--base-url",
    baseUrl,
    "--event",
    slug,
    "--receipts",
    receipts,
  ];
  await execute(process.execPath, mediaArgs, options);
  await execute(process.execPath, [...mediaArgs, "--apply"], options);
  await execute(process.execPath, [...mediaArgs, "--apply"], options);
  for (const { media } of presentations) {
    const id = occurrences[media.authoredReference]!;
    const versions = sessionPresentationVersionsSchema.parse(
      await (await page.request.get(`/api/v1/events/${slug}/agenda/occurrences/${id}/materials/presentations`)).json(),
    ).versions;
    expect(versions).toHaveLength(1);
    expect(versions[0]!.latestReview).toBeNull();
    const bytes = await (
      await page.request.get(
        `/api/v1/events/${slug}/agenda/occurrences/${id}/materials/presentations/${versions[0]!.id}/content`,
      )
    ).body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(media.sourceDigest);
  }
  const finalDraft = await read();
  expect(finalDraft.publishedRevision).toBeNull();
  expect(
    finalDraft.occurrences
      .flatMap((row) => row.history?.materials ?? [])
      .every((material) => material.status === "draft" && material.approvedAt === null),
  ).toBe(true);
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await page.getByRole("tab", { name: "All sessions", exact: true }).click();
  const networkingRow = page.getByRole("row").filter({ has: page.getByText("Networking", { exact: true }) });
  await expect(networkingRow).toBeVisible();
  const timeHeader = page
    .getByRole("columnheader")
    .filter({ has: page.getByRole("button", { name: "Time", exact: true }) });
  if ((await timeHeader.getAttribute("aria-sort")) !== "ascending") {
    await timeHeader.getByRole("button", { name: "Time", exact: true }).click();
  }
  await expect(timeHeader).toHaveAttribute("aria-sort", "ascending");
  const table = page.getByRole("table").filter({ has: networkingRow });
  const sessionRows = table.getByRole("row").filter({ has: page.getByRole("cell") });
  await expect(sessionRows).toHaveCount(14);
  await expect(sessionRows.last().getByText("Networking", { exact: true })).toBeVisible();
  const dayCell = networkingRow.getByRole("cell").filter({
    has: page.locator(".pk-table__mobile-label").filter({ hasText: /^Day$/ }),
  });
  const timeCell = networkingRow.getByRole("cell").filter({
    has: page.locator(".pk-table__mobile-label").filter({ hasText: /^Time$/ }),
  });
  await expect(dayCell.locator(".pk-table__value")).toHaveText("Mar 3, 2023");
  await expect(timeCell.locator(".pk-table__value")).toContainText("15:30");
  await expect(timeCell.locator(".pk-table__value")).toContainText("End not recorded");
  await expect(networkingRow).not.toContainText("Unscheduled");
  await expect(networkingRow.getByText("Not checked", { exact: true })).toBeVisible();
  const sourceCreditTitle = imported.occurrences.find(
    (row) => row.startAt && (row.history?.archivalCredits.length ?? 0) > 0,
  )!.title;
  const sourceCreditRow = table.getByRole("row").filter({ has: page.getByText(sourceCreditTitle, { exact: true }) });
  const needsReview = sourceCreditRow.getByRole("img", {
    name: "Conflict checks are incomplete; review unresolved source credits.",
  });
  await expect(needsReview).toHaveText("Needs review");
  await expect(needsReview).toHaveClass(/pk-badge--warn/);
  await expect(needsReview).not.toHaveClass(/pk-badge--ok/);
  await expect(sourceCreditRow.getByText("Clear", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("historical-ottawa-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("historical-ottawa-phone.png"), fullPage: true });
});
