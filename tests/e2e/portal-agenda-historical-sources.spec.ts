import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../assets/shared/schemas/group-events";
import { agendaSnapshotSchema, agendaRoomCreateSchema } from "../../assets/shared/schemas/event-agenda";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferReviewSchema,
} from "../../assets/shared/schemas/event-agenda-transfer";
import { dateTimeLocalToIso } from "../../assets/shared/timezone";
import { sessionPresentationVersionsSchema } from "../../assets/shared/schemas/session-presentation-versions";
import { USER_SESSION_COOKIE_NAME } from "../../functions/_lib/auth/session-cookies";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { expectStaffSessionLanding, signInAsE2eStaff } from "./helpers/staff-auth";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";

const execute = promisify(execFile);
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
// These explicit fixture choices exercise draft preservation. They are not migration approval.
const sources = [
  {
    name: "Amsterdam 2023",
    key: "amsterdam",
    source: "content/events/2023/pqc-conference-amsterdam-nl/index.md",
    fileDigest: "f38c44c03622d5d9dc06b7d641e0628c816f7832450f37a4d7e3520b9ffeda8d",
    sourceDigest: "5b3147c60efb49c007578dd776faccbc0e022a105d91eb480787e12eb353b669",
    timezone: "Europe/Amsterdam",
    first: "2023-11-07",
    last: "2023-11-08",
    rows: 58,
    sessions: 48,
    pdfs: 39,
    rooms: ["plenary", "breakout"],
    missingTitles: ["2023-11-07:5:1", "2023-11-07:7:1", "2023-11-07:9:1"],
    missingCredits: { "2023-11-07:5:1": "None", "2023-11-07:7:1": "None", "2023-11-07:9:1": "None" },
  },
  {
    name: "Austin 2025",
    key: "austin",
    source: "content/events/2025/pqc-conference-austin-us/index.md",
    fileDigest: "fa8b8bd508a53f2baa8625f0d3f0e9af93e5f0aacca0da79ef5ed04e001ffc19",
    sourceDigest: "01c97c989cd3a6e8c2694033278aa062285386f56d0002723ca98f7246811e2d",
    timezone: "America/Chicago",
    first: "2025-01-15",
    last: "2025-01-16",
    rows: 54,
    sessions: 43,
    pdfs: 36,
    rooms: ["plenary", "breakout"],
    missingTitles: ["2025-01-15:14:1"],
    missingCredits: { "2025-01-15:14:1": "TBC" },
  },
  {
    name: "Kuala Lumpur 2025",
    key: "kuala-lumpur",
    source: "content/events/2025/pqc-conference-kuala-lumpur-my/_index.md",
    fileDigest: "57e182eadb0e1f620685143e3db4908a0809bd745ffbcbb9ca4e20ee277a0943",
    sourceDigest: "617c0613f9fc27e32001e7c03b2fa4ef51a9ee3552704bc28089cf4d47394c3c",
    timezone: "Asia/Kuala_Lumpur",
    first: "2025-10-28",
    last: "2025-10-30",
    rows: 83,
    sessions: 67,
    pdfs: 38,
    rooms: ["room_1", "room_8", "room_3", "room_4", "room_5", "room_6", "room_7", "room_2", "plenary", "breakout"],
    missingTitles: [],
    missingCredits: { "2025-10-28:3:0": "TBD", "2025-10-28:7:0": "TBD" },
  },
];

const staffEmail = e2eAdminEmail("browser-presentation");
let staffStatePath: string;
test.beforeAll(async ({ browser }, info) => {
  staffStatePath = join(info.project.outputDir, `historical-sources-auth-${process.pid}-${info.workerIndex}.json`);
  await mkdir(info.project.outputDir, { recursive: true });
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await signInAsE2eStaff(page, staffEmail);
    await context.storageState({ path: staffStatePath });
  } finally {
    await context.close();
  }
});
test.use({
  actionTimeout: 20_000,
  storageState: async ({ browser }, use) => {
    expect(browser.isConnected()).toBe(true);
    await use(staffStatePath);
  },
});
for (const source of sources) {
  test(`${source.name}: preserve all authored rows and reconcile only eligible private drafts`, async ({
    page,
  }, info) => {
    test.setTimeout(600_000);
    expect(hash(await readFile(source.source))).toBe(source.fileDigest);
    await page.goto("/portal/#/home");
    await expectStaffSessionLanding(page);
    const sessionResponse = await page.request.get("/api/v1/auth/session");
    expect(sessionResponse.status()).toBe(200);
    const session = userAuthSessionResponseSchema.parse(await sessionResponse.json());
    expect(session.identity.email).toBe(staffEmail);
    expect(session.staff).toBeDefined();
    const slug = `historical-${source.key}-${crypto.randomUUID().slice(0, 8)}`;
    const response = await page.request.post("/api/v1/groups/20000000-0000-4000-8000-000000000003/events", {
      data: groupEventCreateSchema.parse({
        slug,
        name: `${source.name} draft rehearsal`,
        timezone: source.timezone,
        startsAt: dateTimeLocalToIso(`${source.first}T00:00`, source.timezone),
        endsAt: dateTimeLocalToIso(`${source.last}T23:59`, source.timezone),
        profileKey: "conference",
        registrationPolicy: "no_registration",
        visibility: "public",
        links: [],
      }),
    });
    expect(response.status(), await response.text()).toBe(201);
    const event = groupEventDetailResponseSchema.parse(await response.json()).event;
    const read = async () =>
      agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
    const roomIds: Record<string, string> = {};
    for (const name of source.rooms) {
      const response = await page.request.post(`/api/v1/events/${slug}/agenda/rooms`, {
        data: agendaRoomCreateSchema.parse({ expectedRevision: (await read()).revision, name, capacity: null }),
      });
      expect(response.ok(), await response.text()).toBe(true);
      roomIds[name] = agendaSnapshotSchema.parse(await response.json()).rooms.find((room) => room.name === name)!.id;
    }
    const reviewedAt = new Date().toISOString();
    const sourceRows: Record<string, Record<string, unknown>> = {};
    for (const [locator, name] of Object.entries(source.missingCredits)) {
      sourceRows[locator] = {
        sourceDigest: source.sourceDigest,
        credits: { [name]: { decision: "credit_not_recorded", reviewedAt } },
      };
    }
    for (const locator of source.missingTitles) {
      sourceRows[locator] = {
        ...sourceRows[locator],
        sourceDigest: source.sourceDigest,
        title: { decision: "title_not_recorded", reviewedAt },
      };
    }
    if (source.key === "kuala-lumpur") {
      for (const locator of ["2025-10-28:1:2", "2025-10-28:5:2"]) {
        sourceRows[locator] = {
          sourceDigest: source.sourceDigest,
          credits: { "Robert Grapes": { decision: "retain_source_credit", reviewedAt } },
        };
      }
      for (const locator of ["2025-10-30:16:0", "2025-10-30:17:0"]) {
        sourceRows[locator] = { sourceDigest: source.sourceDigest, sourceKey: `rehearsal:kl:${locator}`, reviewedAt };
      }
    }
    const sandraReference =
      "pkic-pqcc_sandra-guasch-castello_sandboxaq_a-sign-of-the-times-the-transition-to-quantum-secure authentication.pdf";
    await mkdir(info.outputDir, { recursive: true });
    const mapping = info.outputPath("explicit-draft-mapping.json");
    let documentPath = info.outputPath("agenda.json");
    await writeFile(
      mapping,
      JSON.stringify(
        {
          event: { eventId: event.id, eventSlug: slug },
          roomIds,
          sourceRows,
          archivePublicSource: true,
          publicBasePath: `/content-media/${source.source.split("/").slice(1, -1).join("/")}`,
          ...(source.key === "amsterdam"
            ? {
                localPresentationFiles: {
                  [sandraReference]: {
                    relativePath: sandraReference.replace("secure authentication", "secure\u00a0authentication"),
                    sourceDigest: "d5fc2a8ec1aa001525ee608dd36742bbae4a90f6165d2cf1c49232ab8128be01",
                    bytes: 1390709,
                  },
                },
              }
            : {}),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await execute(
      process.execPath,
      ["--experimental-strip-types", "scripts/prepare-agenda-import.mjs", source.source, mapping, documentPath],
      { timeout: 60_000 },
    );
    let document = agendaTransferSchema.parse(JSON.parse(await readFile(documentPath, "utf8")));
    let report = JSON.parse(await readFile(`${documentPath}.report.json`, "utf8"));
    expect(document.occurrences).toHaveLength(source.rows);
    expect(document.occurrences.filter((row) => row.fields.kind === "session")).toHaveLength(source.sessions);
    expect(report.sourceRows).toHaveLength(source.rows);
    expect(new Set(document.occurrences.map((row) => row.sourceKey)).size).toBe(source.rows);
    expect(document.people.every((person) => person.canonicalUserId === null)).toBe(true);
    for (const placeholder of ["None", "TBC", "TBD"])
      expect(document.people.map((person) => person.ref)).not.toContain(placeholder);
    for (const locator of source.missingTitles) {
      const row = report.sourceRows.find((row: { sourceLocator: string }) => row.sourceLocator === locator);
      const occurrence = document.occurrences.find((item) => item.sourceKey === row.sourceKey)!;
      expect(occurrence.fields.title).toBe("Title not recorded");
      expect(occurrence.archive!.sourceDecisions).toContainEqual(
        expect.objectContaining({ kind: "title", authoredValue: row.authoredTitle, decision: "title_not_recorded" }),
      );
    }
    const token = (await page.context().cookies()).find((cookie) => cookie.name === USER_SESSION_COOKIE_NAME)!.value;
    const options = {
      env: { ...process.env, PKIC_AGENDA_IMPORT_TOKEN: token },
      timeout: 240_000,
      maxBuffer: 10 * 1024 * 1024,
    };
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
    if (source.key === "kuala-lumpur") {
      expect(report.ready).toBe(false);
      expect(report.unresolved).toContainEqual(
        expect.objectContaining({
          mediaKind: "recording",
          authoredReference: "-alNmwb9-fT0",
          reason: "invalid_recording_reference",
        }),
      );
      expect(report.headshots.unresolved).toContainEqual(
        expect.objectContaining({
          authoredReference: "speakers/megat-zuhairy-bin-megat-tajuddin.*",
          reason: "invalid_or_changed_local_image",
        }),
      );
      const malformed = document.occurrences
        .flatMap((row) => row.media)
        .find((media) => media.authoredReference === "-alNmwb9-fT0")!;
      expect(malformed.publicUrl).toBeNull();
      await expect(execute(process.execPath, [...args, "--apply"], options)).rejects.toMatchObject({
        stderr: expect.stringContaining("Preparation report has unresolved findings."),
      });
      expect((await read()).occurrences).toHaveLength(0);
      expect((await read()).publishedRevision).toBeNull();
      const reviewedMapping = info.outputPath("reviewed-kl-mapping.json"),
        reviewedDocument = info.outputPath("reviewed-kl-agenda.json"),
        headshotPath = "speakers/megat-zuhairy-bin-megat-tajuddin.jpg",
        headshot = await readFile(`${source.source.split("/").slice(0, -1).join("/")}/${headshotPath}`);
      expect(hash(headshot)).toBe("d1558f2d4a1413876f2f7c7cb22c3c22c8577cb03de7b94fd665818f698caf1d");
      expect(headshot.length).toBe(618499);
      expect(Array.from(headshot.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      await writeFile(
        reviewedMapping,
        JSON.stringify(
          {
            ...JSON.parse(await readFile(mapping, "utf8")),
            recordingUrls: { "-alNmwb9-fT0": "https://www.youtube.com/watch?v=alNmwb9-fT0" },
            localHeadshotFiles: {
              "speakers/megat-zuhairy-bin-megat-tajuddin.*": {
                relativePath: headshotPath,
                sourceDigest: "d1558f2d4a1413876f2f7c7cb22c3c22c8577cb03de7b94fd665818f698caf1d",
                bytes: 618499,
                mediaType: "image/png",
              },
            },
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      await execute(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/prepare-agenda-import.mjs",
          source.source,
          reviewedMapping,
          reviewedDocument,
        ],
        { timeout: 60_000 },
      );
      const verifiedReport = JSON.parse(await readFile(`${reviewedDocument}.report.json`, "utf8"));
      expect(verifiedReport.sourceRows).toEqual(report.sourceRows);
      expect(verifiedReport.sourceDecisions).toEqual(report.sourceDecisions);
      document = agendaTransferSchema.parse(JSON.parse(await readFile(reviewedDocument, "utf8")));
      report = verifiedReport;
      documentPath = reviewedDocument;
      args[args.indexOf("--document") + 1] = documentPath;
      expect(document.source.sourceDigest).toBe(source.sourceDigest);
      expect(document.occurrences).toHaveLength(83);
      expect(document.occurrences.filter((row) => row.fields.kind === "session")).toHaveLength(67);
      expect(document.people).toHaveLength(73);
      expect(
        document.people.every((person) => person.canonicalUserId === null && person.actingIdentityId === null),
      ).toBe(true);
      expect(new Set(document.occurrences.map((row) => row.sourceKey)).size).toBe(83);
      expect(
        new Set(
          document.occurrences.flatMap((row) => row.archive?.archivalCredits.map((credit) => credit.sourceRef) ?? []),
        ).size,
      ).toBe(73);
      expect(report).toMatchObject({
        applied: false,
        event: { target: { eventId: event.id, eventSlug: slug } },
        counts: { occurrences: 83, people: 73, rooms: 10, mediaReferences: 85 },
      });
      expect(report.assets).toHaveLength(38);
      expect(report.headshots.assets).toHaveLength(72);
      expect(report.headshots.unresolved).toEqual([]);
      expect(document.rooms.map((room) => room.canonicalRoomId).sort()).toEqual(Object.values(roomIds).sort());
      for (const locator of ["2025-10-30:16:0", "2025-10-30:17:0"])
        expect(document.occurrences.filter((row) => row.sourceKey === `rehearsal:kl:${locator}`)).toHaveLength(1);
      expect(
        document.occurrences.flatMap((row) => row.media).find((media) => media.authoredReference === "-alNmwb9-fT0"),
      ).toMatchObject({ publicUrl: "https://www.youtube.com/watch?v=alNmwb9-fT0" });
    }
    expect(report.ready, JSON.stringify(report.unresolved)).toBe(true);
    // Persist the mounted backend findings before a CLI failure can hide its summary.
    const mountedReviewResponse = await page.request.post(`/api/v1/events/${slug}/agenda/transfers/reviews`, {
      data: transferPrepareSchema.parse({
        expectedRevision: (await read()).revision,
        mode: "archive",
        document,
        resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
      }),
    });
    const mountedReviewText = await mountedReviewResponse.text();
    await writeFile(info.outputPath("mounted-review-response.json"), mountedReviewText, { mode: 0o600 });
    expect(mountedReviewResponse.status(), mountedReviewText).toBe(200);
    const mountedReview = transferReviewSchema.parse(JSON.parse(mountedReviewText));
    expect(
      mountedReview.ready,
      JSON.stringify(mountedReview.findings.filter((finding) => finding.severity === "blocking")),
    ).toBe(true);
    const review = await execute(process.execPath, args, options);
    expect(review.stdout).not.toContain(token);
    expect((await read()).occurrences).toHaveLength(0);
    await execute(process.execPath, [...args, "--apply"], options);
    const imported = await read();
    expect(imported.occurrences).toHaveLength(source.rows);
    expect(imported.occurrences.every((row) => row.speakers.length === 0)).toBe(true);
    expect(imported.occurrences.every((row) => (row.history?.appearances.length ?? 0) === 0)).toBe(true);
    if (source.key === "kuala-lumpur")
      expect(
        new Set(
          imported.occurrences.flatMap((row) => row.history?.archivalCredits.map((credit) => credit.sourceRef) ?? []),
        ).size,
      ).toBe(73);
    await execute(process.execPath, [...args, "--apply"], options);
    expect((await read()).occurrences.map((row) => row.id).sort()).toEqual(
      imported.occurrences.map((row) => row.id).sort(),
    );
    const exported = agendaTransferSchema.parse(
      await (await page.request.get(`/api/v1/events/${slug}/agenda/transfers/exports?limit=100`)).json(),
    );
    if (source.key === "kuala-lumpur") {
      for (const authored of document.occurrences) {
        const retained = exported.occurrences.find((row) => row.sourceKey === authored.sourceKey);
        expect(retained).toBeDefined();
        expect(retained!.fields.title).toBe(authored.fields.title);
        expect(retained!.archive?.archivalCredits ?? []).toEqual(authored.archive?.archivalCredits ?? []);
        expect(retained!.archive?.sourceDecisions ?? []).toEqual(authored.archive?.sourceDecisions ?? []);
        expect(retained!.archive?.archivalTiming ?? null).toEqual(authored.archive?.archivalTiming ?? null);
        expect(retained!.media.filter((media) => media.kind === "recording").map((media) => media.publicUrl)).toEqual(
          authored.media.filter((media) => media.kind === "recording").map((media) => media.publicUrl),
        );
      }
    }
    const presentations = document.occurrences.flatMap((row) =>
      row.media.filter((media) => media.kind === "presentation").map((media) => ({ row, media })),
    );
    expect(presentations).toHaveLength(source.pdfs);
    const occurrences = Object.fromEntries(
      presentations.map(({ row, media }) => [
        media.authoredReference,
        exported.occurrences.find((item) => item.sourceKey === row.sourceKey)!.ref,
      ]),
    );
    expect(Object.keys(occurrences)).toHaveLength(source.pdfs);
    const mediaMapping = info.outputPath("material-occurrences.json"),
      receipts = info.outputPath("material-receipts.json");
    await writeFile(mediaMapping, JSON.stringify(occurrences), { mode: 0o600 });
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
    const uploadedReceipts = await readFile(receipts, "utf8");
    const replay = await execute(process.execPath, [...mediaArgs, "--apply"], options);
    expect(JSON.parse(replay.stdout)).toMatchObject({
      planned: source.pdfs,
      uploaded: 0,
      reconciled: source.pdfs,
      applied: true,
      published: false,
    });
    expect(await readFile(receipts, "utf8")).toBe(uploadedReceipts);
    for (const { media } of presentations) {
      const id = occurrences[media.authoredReference]!;
      const versions = sessionPresentationVersionsSchema.parse(
        await (
          await page.request.get(`/api/v1/events/${slug}/agenda/occurrences/${id}/materials/presentations`)
        ).json(),
      ).versions;
      expect(versions).toHaveLength(1);
      expect(versions[0]!.latestReview).toBeNull();
      expect(versions[0]!.sourceDigest).toBe(media.sourceDigest);
      expect(versions[0]!.fileSize).toBe(media.bytes);
      const content = await page.request.get(
        `/api/v1/events/${slug}/agenda/occurrences/${id}/materials/presentations/${versions[0]!.id}/content`,
      );
      expect(content.status()).toBe(200);
      expect(hash(await content.body())).toBe(media.sourceDigest);
    }
    const finalDraft = await read();
    expect(finalDraft.publishedRevision).toBeNull();
    expect(
      finalDraft.occurrences
        .flatMap((row) => row.history?.materials ?? [])
        .every((material) => material.status === "draft" && material.approvedAt === null),
    ).toBe(true);
    expect(
      finalDraft.occurrences
        .flatMap((row) => row.history?.materials ?? [])
        .every(
          (material) =>
            !material.rightsConfirmed &&
            !material.consentConfirmed &&
            !material.validated &&
            material.legacyDownloadUrl === null,
        ),
    ).toBe(true);
    expect(hash(await readFile(source.source))).toBe(source.fileDigest);
  });
}
