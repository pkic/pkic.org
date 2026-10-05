import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../assets/shared/schemas/group-events";
import {
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaRevisionSchema,
} from "../../assets/shared/schemas/event-agenda";
import {
  agendaContentsResponseSchema,
  agendaContentPatchSchema,
} from "../../assets/shared/schemas/event-agenda-content";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferReviewSchema,
  transferResolutionSchema,
} from "../../assets/shared/schemas/event-agenda-transfer";
import { sessionAppearanceSchema } from "../../assets/shared/schemas/event-session-history";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { dateTimeLocalToIso } from "../../assets/shared/timezone";
import { USER_SESSION_COOKIE_NAME } from "../../functions/_lib/auth/session-cookies";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { runAgendaAction } from "./helpers/agenda-actions";

const execute = promisify(execFile);
const authoredSource = "content/events/2025/pqc-conference-austin-us/index.md";
const fileDigest = "fa8b8bd508a53f2baa8625f0d3f0e9af93e5f0aacca0da79ef5ed04e001ffc19";
const parsedDigest = "01c97c989cd3a6e8c2694033278aa062285386f56d0002723ca98f7246811e2d";
const sourceLocator = "2025-01-15:15:0";
const title = "Closing remarks for day 1";
const names = ["Paul van Brouwershaven", "Albert de Ruiter"];
const syntheticNames = ["Historical mapping fixture reviewer", "Historical mapping fixture speaker"];
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
test.use({ actionTimeout: 20_000 });

test("an actual selected source row stages canonical fixture attribution for visible review before local publication", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  await mkdir(info.outputDir, { recursive: true });
  expect(hash(await readFile(authoredSource))).toBe(fileDigest);
  await signInAsE2eStaff(page, e2eAdminEmail("browser-historical-mapping-review"));
  const origin = new URL(page.url()).origin;
  const reviewer = userAuthSessionResponseSchema.parse(
    await (await page.request.get("/api/v1/auth/session")).json(),
  ).identity;
  const secondContext = await browser.newContext({ baseURL: origin });
  try {
    const secondPage = await secondContext.newPage();
    await signInAsE2eStaff(secondPage, e2eAdminEmail("browser-historical-mapping-speaker"));
    const speaker = userAuthSessionResponseSchema.parse(
      await (await secondPage.request.get("/api/v1/auth/session")).json(),
    ).identity;
    expect(speaker.id).not.toBe(reviewer.id);
    const canonicalUserIds = [reviewer.id, speaker.id];
    const slug = `historical-mapping-review-${crypto.randomUUID().slice(0, 8)}`;
    const endpoint = `/api/v1/events/${slug}/agenda`;
    const eventResponse = await page.request.post("/api/v1/groups/20000000-0000-4000-8000-000000000003/events", {
      data: groupEventCreateSchema.parse({
        slug,
        name: "Historical mapping fixture: selected Austin source row",
        timezone: "America/Chicago",
        startsAt: dateTimeLocalToIso("2025-01-15T00:00", "America/Chicago"),
        endsAt: dateTimeLocalToIso("2025-01-16T23:59", "America/Chicago"),
        profileKey: "conference",
        registrationPolicy: "no_registration",
        visibility: "public",
        links: [],
      }),
    });
    expect(eventResponse.status(), await eventResponse.text()).toBe(201);
    const event = groupEventDetailResponseSchema.parse(await eventResponse.json()).event;
    const read = async () => agendaSnapshotSchema.parse(await (await page.request.get(endpoint)).json());
    const contents = async () =>
      agendaContentsResponseSchema.parse(
        await (await page.request.get(`${endpoint}/contents?limit=25&offset=0`)).json(),
      ).contents;
    const roomIds: Record<string, string> = {};
    for (const name of ["plenary", "breakout"]) {
      const result = await page.request.post(`${endpoint}/rooms`, {
        data: agendaRoomCreateSchema.parse({ expectedRevision: (await read()).revision, name, capacity: null }),
      });
      expect(result.status(), await result.text()).toBe(200);
      roomIds[name] = agendaSnapshotSchema.parse(await result.json()).rooms.find((room) => room.name === name)!.id;
    }
    const reviewedAt = new Date().toISOString();
    const mappingPath = info.outputPath("full-source-draft-fixture-mapping.json"),
      fullPath = info.outputPath("full-austin-source.json");
    await writeFile(
      mappingPath,
      JSON.stringify(
        {
          event: { eventId: event.id, eventSlug: slug },
          roomIds,
          archivePublicSource: true,
          publicBasePath: "/content-media/events/2025/pqc-conference-austin-us",
          sourceRows: {
            "2025-01-15:14:1": {
              sourceDigest: parsedDigest,
              title: { decision: "title_not_recorded", reviewedAt },
              credits: { TBC: { decision: "credit_not_recorded", reviewedAt } },
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
      ["--experimental-strip-types", "scripts/prepare-agenda-import.mjs", authoredSource, mappingPath, fullPath],
      { timeout: 60_000 },
    );
    const fullDocument = agendaTransferSchema.parse(JSON.parse(await readFile(fullPath, "utf8")));
    const fullReport = JSON.parse(await readFile(`${fullPath}.report.json`, "utf8"));
    expect(fullDocument.occurrences).toHaveLength(54);
    expect(fullDocument.occurrences.filter((row) => row.fields.kind === "session")).toHaveLength(43);
    expect(fullReport.ready, JSON.stringify(fullReport.unresolved)).toBe(true);
    const sourceRow = fullReport.sourceRows.find(
      (row: { sourceLocator: string }) => row.sourceLocator === sourceLocator,
    );
    const selected = fullDocument.occurrences.find((row) => row.sourceKey === sourceRow.sourceKey)!;
    expect(selected.fields.title).toBe(title);
    expect(selected.personRefs).toEqual(names);
    expect(selected.media).toEqual([]);
    expect(selected.archive!.archivalCredits.map((credit) => credit.displayName)).toEqual(names);
    const document = agendaTransferSchema.parse({
      ...fullDocument,
      occurrences: [selected],
      people: fullDocument.people.filter((person) => selected.personRefs.includes(person.ref)),
      rooms: fullDocument.rooms.filter((room) => selected.roomRefs.includes(room.ref)),
    });
    const selectedPath = info.outputPath("selected-real-source-row-fixture.json");
    await writeFile(selectedPath, JSON.stringify(document, null, 2), { mode: 0o600 });
    await writeFile(
      `${selectedPath}.report.json`,
      JSON.stringify(
        {
          ...fullReport,
          outputs: [{ path: selectedPath, occurrences: 1, state: "prepared_not_applied" }],
          counts: { ...fullReport.counts, occurrences: 1, people: 2, rooms: 1, mediaReferences: 0 },
          sourceRows: [sourceRow],
          assets: [],
          selection: {
            scope: "one-row local synthetic canonical mapping fixture; not a full historical migration",
            fullSourceRows: 54,
            sourceLocator,
            fullDocumentDigest: hash(await readFile(fullPath)),
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const token = (await page.context().cookies()).find((cookie) => cookie.name === USER_SESSION_COOKIE_NAME)!.value;
    const options = { env: { ...process.env, PKIC_AGENDA_IMPORT_TOKEN: token }, timeout: 60_000 };
    const cli = (path: string) => [
      "--experimental-strip-types",
      "scripts/import-agenda.mjs",
      "--base-url",
      origin,
      "--event",
      slug,
      "--document",
      path,
      "--acknowledge-inferred-timing",
      "--acknowledge-archive-representation",
    ];
    const recordCli = async (label: string, args: string[]) => {
      try {
        const result = await execute(process.execPath, args, options);
        expect(result.stdout).not.toContain(token);
        await writeFile(info.outputPath(`${label}.jsonl`), result.stdout, { mode: 0o600 });
        return result;
      } catch (error) {
        if (typeof error === "object" && error !== null) {
          const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
          const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
          await writeFile(
            info.outputPath(`${label}-failure.json`),
            JSON.stringify(
              {
                stdout: stdout.replaceAll(token, "[redacted]"),
                stderr: stderr.replaceAll(token, "[redacted]"),
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
        }
        throw error;
      }
    };
    const mountedReview = async (label: string, body: unknown) => {
      const result = await page.request.post(`${endpoint}/transfers/reviews`, {
        data: transferPrepareSchema.parse(body),
      });
      const text = await result.text();
      await writeFile(info.outputPath(`${label}-mounted-review.json`), text, { mode: 0o600 });
      expect(result.status(), text).toBe(200);
      const review = transferReviewSchema.parse(JSON.parse(text));
      expect(review.ready, JSON.stringify(review.findings)).toBe(true);
      return review;
    };
    const emptyResolutions = transferResolutionSchema.parse({ people: {}, rooms: {}, media: {}, rows: {} });
    await mountedReview("source-only", {
      expectedRevision: (await read()).revision,
      mode: "archive",
      document,
      resolutions: emptyResolutions,
    });
    await recordCli("source-only-cli-review", cli(selectedPath));
    expect((await read()).occurrences).toHaveLength(0);
    await recordCli("source-only-cli-apply", [...cli(selectedPath), "--apply"]);
    const draft = await read(),
      occurrenceId = draft.occurrences[0]!.id;
    expect(draft.occurrences).toHaveLength(1);
    expect(draft.occurrences[0]!.speakers).toHaveLength(0);
    expect(draft.occurrences[0]!.history!.archivalCredits.map((credit) => credit.displayName)).toEqual(names);
    expect(draft.publishedRevision).toBeNull();
    const refusedPublication = await page.request.post(`${endpoint}/publications`, {
      data: agendaRevisionSchema.parse({ expectedRevision: draft.revision }),
    });
    expect(refusedPublication.status()).toBe(422);
    expect((await read()).revision).toBe(draft.revision);
    const incoming = structuredClone(document);
    for (const [index, name] of names.entries()) {
      const person = incoming.people.find((person) => person.ref === name)!;
      person.canonicalUserId = canonicalUserIds[index]!;
      person.label = syntheticNames[index]!;
      person.actingIdentityId = null;
      incoming.occurrences[0]!.personRoles[name] = "speaker";
    }
    const incomingRow = incoming.occurrences[0]!;
    // Explicit prior-title alias for this synthetic mapping fixture, reviewed with the incoming source.
    const reviewedOldPath = `/events/${slug}/sessions/previous-closing-title/`;
    incomingRow.archive!.legacyPaths = [reviewedOldPath];
    incomingRow.archive!.archivalCredits = [];
    incomingRow.archive!.appearances = canonicalUserIds.map((userId, index) =>
      sessionAppearanceSchema.parse({
        userId,
        actingIdentityId: null,
        displayName: syntheticNames[index],
        organizationName: null,
        jobTitle: null,
        biography: "Synthetic local canonical mapping fixture.",
        photoUrl: null,
        approvedAt: reviewedAt,
      }),
    );
    const incomingPath = info.outputPath("selected-canonical-fixture-review.json");
    await writeFile(incomingPath, JSON.stringify(incoming, null, 2), { mode: 0o600 });
    const resolutions = transferResolutionSchema.parse({ ...emptyResolutions, rows: { [incomingRow.ref]: "import" } });
    const resolutionPath = info.outputPath("explicit-canonical-row-resolution.json");
    await writeFile(resolutionPath, JSON.stringify(resolutions, null, 2), { mode: 0o600 });
    const canonicalArgs = [...cli(incomingPath), "--resolutions", resolutionPath];
    await recordCli("canonical-fixture-cli-review", canonicalArgs);
    await mountedReview("canonical-fixture", {
      expectedRevision: draft.revision,
      mode: "archive",
      document: incoming,
      resolutions,
    });
    const applied = await recordCli("canonical-fixture-cli-stage", [...canonicalArgs, "--apply"]);
    const stagedSummary = JSON.parse(applied.stdout.trim().split("\n").at(-1)!);
    expect(stagedSummary.imported).toBe(0);
    const staged = await read();
    expect(staged.occurrences[0]!.id).toBe(occurrenceId);
    expect(staged.occurrences[0]!.speakers).toHaveLength(0);
    expect(staged.publishedRevision).toBeNull();
    const pending = (await contents())[0]!;
    expect([...pending.review!.incoming!.speakerUserIds].sort()).toEqual([...canonicalUserIds].sort());
    expect(pending.review!.incomingHistoricalMetadata![0]!.reviewIssues).toEqual([]);
    expect(
      pending.review!.incomingHistoricalMetadata![0]!.originalMetadata.archivalCredits.map(
        (credit) => credit.displayName,
      ),
    ).toEqual(names);
    await writeFile(info.outputPath("pending-canonical-review.json"), JSON.stringify(pending, null, 2), {
      mode: 0o600,
    });
    const beforeRefusal = await read();
    const refused = await page.request.patch(`${endpoint}/contents/${pending.id}`, {
      data: agendaContentPatchSchema.parse({
        expectedRevision: beforeRefusal.revision,
        content: {
          ...pending.review!.incoming!,
          speakerUserIds: [reviewer.id],
          speakerRoles: { [reviewer.id]: "speaker" },
        },
        resolveSourceReview: true,
      }),
    });
    expect(refused.status(), await refused.text()).toBe(422);
    expect(await read()).toEqual(beforeRefusal);
    expect((await contents())[0]!.review).toEqual(pending.review);
    await page.goto(`/portal/#/events/${slug}/agenda`);
    await page.getByRole("tab", { name: "Session library", exact: true }).click();
    await page.getByRole("button", { name: `Edit ${title}`, exact: true }).click();
    await expect(page.getByRole("button", { name: "Use incoming source content", exact: true })).toBeVisible();
    const acknowledgment = page.getByRole("checkbox", {
      name: "Approve the displayed verified historical mappings and source changes",
      exact: true,
    });
    await expect(acknowledgment).toBeEnabled();
    await expect(acknowledgment).not.toBeChecked();
    const originalAttribution = page.getByRole("region", { name: "Original historical attribution", exact: true });
    for (const name of names) await expect(originalAttribution.getByText(name, { exact: true }).first()).toBeVisible();
    const verifiedAttribution = page.getByRole("region", { name: "Verified incoming attribution", exact: true });
    for (const name of syntheticNames)
      await expect(verifiedAttribution.getByText(name, { exact: true }).first()).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          requestAnimationFrame(() => resolve());
        }),
    );
    await page.screenshot({ path: info.outputPath("historical-mapping-review-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          requestAnimationFrame(() => resolve());
        }),
    );
    await page.screenshot({ path: info.outputPath("historical-mapping-review-phone.png"), fullPage: true });
    await page.getByRole("button", { name: "Use incoming source content", exact: true }).click();
    await expect(acknowledgment).not.toBeChecked();
    await acknowledgment.check();
    await page.getByRole("button", { name: "Save session content", exact: true }).click();
    await expect.poll(async () => (await contents())[0]!.review).toBeNull();
    const accepted = await read();
    expect(accepted.occurrences[0]!.id).toBe(occurrenceId);
    expect(accepted.occurrences[0]!.speakers.map((person) => person.userId).sort()).toEqual(
      [...canonicalUserIds].sort(),
    );
    expect(accepted.occurrences[0]!.history!.archivalCredits).toEqual([]);
    expect(accepted.occurrences[0]!.history!.appearances).toEqual(incomingRow.archive!.appearances);
    expect(accepted.occurrences[0]!.history!.legacyPaths).toContain(reviewedOldPath);
    expect(accepted.publishedRevision).toBeNull();
    await runAgendaAction(page, "Review for publication");
    const approvalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === `${endpoint}/publications`,
    );
    await page.getByRole("button", { name: "Approve for publication", exact: true }).click();
    const approval = await approvalResponse;
    expect(approval.status(), await approval.text()).toBe(200);
    const approvedRevision = accepted.revision + 1;
    const approvalSnapshot = agendaSnapshotSchema.parse(await approval.json());
    expect(approvalSnapshot.revision).toBe(approvedRevision);
    expect(approvalSnapshot.publishedRevision).toBe(approvedRevision);
    expect(approvalSnapshot.rooms).toEqual(accepted.rooms);
    expect(approvalSnapshot.occurrences).toEqual(
      accepted.occurrences.map((occurrence) => ({ ...occurrence, publicationStatus: "published" })),
    );
    await expect.poll(async () => (await read()).publishedRevision).toBe(approvedRevision);
    const published = await read();
    expect(published).toEqual(approvalSnapshot);
    const readApproved = async () => {
      const response = await page.request.get(`${endpoint}/previews?revision=approved`);
      expect(response.status(), await response.text()).toBe(200);
      return agendaSnapshotSchema.parse(await response.json());
    };
    const frozen = await readApproved();
    expect(frozen.revision).toBe(approvedRevision);
    expect(frozen.publishedRevision).toBe(approvedRevision);
    expect(frozen.occurrences[0]!.history!.legacyPaths).toContain(reviewedOldPath);
    expect(frozen.rooms).toEqual(accepted.rooms);
    expect(frozen.occurrences).toEqual(
      accepted.occurrences.map((occurrence) => ({
        ...occurrence,
        speakers: occurrence.speakers.map(({ userId, displayName, role }) => ({ userId, displayName, role })),
        history: {
          ...occurrence.history,
          sourceDecisions: [],
          proposalRepresentations: [],
          materials: [],
        },
      })),
    );
    await page.getByRole("button", { name: "Back to agenda", exact: true }).click();
    await runAgendaAction(page, "Public preview");
    await page.getByRole("button", { name: "Approved revision", exact: true }).click();
    await page.locator('[data-agenda-tab="2025-01-15"]').click();
    await expect(page.getByRole("button", { name: `Open session details: ${title}`, exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          requestAnimationFrame(() => resolve());
        }),
    );
    const sessionCard = page.locator(`article[data-agenda-occurrence="${occurrenceId}"]`);
    await expect(sessionCard).toHaveCount(1);
    const sessionBody = sessionCard.locator(".pk-content-agenda__session-body");
    const visibleContent = [
      sessionBody.getByRole("heading", { level: 3, name: title, exact: true }),
      ...syntheticNames.map((name) => sessionBody.getByText(name, { exact: true })),
    ];
    for (const content of visibleContent) await expect(content).toBeVisible();
    // A short session must fit its title and both mapped speakers without clipping.
    await expect
      .poll(
        async () => {
          const containers = await Promise.all([sessionCard.boundingBox(), sessionBody.boundingBox()]);
          const boxes = await Promise.all(visibleContent.map((content) => content.boundingBox()));
          return boxes.map((box) =>
            Boolean(
              box &&
              containers.every(
                (container) =>
                  container &&
                  box.x >= container.x &&
                  box.y >= container.y &&
                  box.x + box.width <= container.x + container.width &&
                  box.y + box.height <= container.y + container.height,
              ),
            ),
          );
        },
        {
          message:
            "The approved five-minute session must show its title and both mapped speaker names inside its card and body",
        },
      )
      .toEqual([true, true, true]);
    await page.screenshot({ path: info.outputPath("historical-mapping-approved-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          requestAnimationFrame(() => resolve());
        }),
    );
    await page.screenshot({ path: info.outputPath("historical-mapping-approved-phone.png"), fullPage: true });
    await recordCli("canonical-fixture-cli-replay", [...canonicalArgs, "--apply"]);
    const replay = await read();
    expect(replay.occurrences).toHaveLength(1);
    expect(replay.occurrences[0]!.id).toBe(occurrenceId);
    expect((await contents())[0]!.review).toBeNull();
    expect(replay.publishedRevision).toBe(approvedRevision);
    expect(await readApproved()).toEqual(frozen);
    expect(hash(await readFile(authoredSource))).toBe(fileDigest);
    await writeFile(
      info.outputPath("fixture-scope-summary.json"),
      JSON.stringify(
        {
          selectedRows: 1,
          fullSourceRows: 54,
          sourceLocator,
          sourceFileDigest: fileDigest,
          parsedSourceDigest: parsedDigest,
          canonicalMappings: "synthetic local users with explicit individual appearances",
          actualMigrationApproved: false,
          remoteWrites: false,
          localFixturePublishedRevision: published.publishedRevision,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await secondContext.close();
  }
});
