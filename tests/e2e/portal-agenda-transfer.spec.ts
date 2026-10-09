import { runAgendaAction } from "./helpers/agenda-actions";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { USER_SESSION_COOKIE_NAME } from "../../functions/_lib/auth/session-cookies";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  userUpdateSchema,
  userUpdateResponseSchema,
  userDetailResponseSchema,
} from "../../assets/shared/schemas/user-management";
import { agendaOccurrenceCreateSchema, agendaPeopleListSchema } from "../../assets/shared/schemas/event-agenda";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { uploadThroughControl } from "./helpers/file-upload";
import { agendaWorkspacePath } from "./helpers/agenda-workspace";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
} from "../../assets/shared/schemas/event-agenda-transfer";
const slug = "pqc-conference-amsterdam-nl";
test.use({ actionTimeout: 20_000 });
test("organizer resolves a reviewed versioned copy and imports only to the draft", async ({ page }) => {
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-transfer-review"));
  let snapshot = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const identity = userAuthSessionResponseSchema.parse(
    await (await page.request.get("/api/v1/auth/session")).json(),
  ).identity;
  const profile = userUpdateSchema.parse({
    firstName: "Synthetic",
    lastName: `Transfer-${identity.id}`,
    preferredName: null,
  });
  const renamed = await page.request.patch(`/api/v1/users/${identity.id}`, { data: profile });
  expect(renamed.status()).toBe(200);
  expect(userUpdateResponseSchema.parse(await renamed.json()).user.id).toBe(identity.id);
  const canonical = await page.request.get(`/api/v1/users/${identity.id}`);
  expect(canonical.status()).toBe(200);
  const personProfile = userDetailResponseSchema.parse(await canonical.json()).user;
  expect(personProfile).toMatchObject({
    id: identity.id,
    first_name: profile.firstName,
    last_name: profile.lastName,
    preferred_name: null,
  });
  const searchName = `${personProfile.first_name} ${personProfile.last_name}`;
  const role = await page.request.post(`/api/v1/events/${slug}/roles`, {
    data: { userId: identity.id, role: "volunteer" },
  });
  expect(role.status(), await role.text()).toBe(201);
  const create = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title: "Portable source session",
      startAt: null,
      endAt: null,
      roomId: null,
      speakerUserIds: [identity.id],
    }),
  });
  expect(create.status(), await create.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await create.json());
  const exported = agendaTransferSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda/transfers/exports?limit=100`)).json(),
  );
  exported.occurrences = exported.occurrences.filter((row) => row.fields.title === "Portable source session");
  expect(exported.occurrences).toHaveLength(1);
  exported.people = exported.people.filter((person) => exported.occurrences[0]!.personRefs.includes(person.ref));
  exported.rooms = exported.rooms.filter((room) => exported.occurrences[0]!.roomRefs.includes(room.ref));
  expect(exported.people).toHaveLength(1);
  exported.occurrences[0]!.ref = "reviewed-browser-copy";
  exported.occurrences[0]!.fields.title = "Reviewed portable browser copy";
  const person = exported.people[0];
  expect(person).toBeDefined();
  expect(person!.canonicalUserId).toBe(identity.id);
  person!.canonicalUserId = null;
  await page.goto(await agendaWorkspacePath(page, slug));
  await runAgendaAction(page, "Import sessions");
  await page.getByRole("button", { name: "Import or export versioned agenda", exact: true }).click();
  await uploadThroughControl(page, page.getByLabel("Versioned agenda JSON", { exact: true }), {
    name: "agenda.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.getByLabel("Import behavior", { exact: true }).selectOption("copy_as_new");
  await page.getByRole("button", { name: "Review import", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toBeDisabled();
  const picker = page.getByLabel(`Canonical person: ${person!.label}`, { exact: true });
  const matchingPeople = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${slug}/agenda/people` &&
      new URL(response.url()).searchParams.get("q") === searchName,
  );
  await picker.fill(searchName);
  const peopleResponse = await matchingPeople;
  expect(peopleResponse.status()).toBe(200);
  const candidates = agendaPeopleListSchema.parse(await peopleResponse.json()).users;
  expect(candidates).toHaveLength(1);
  const candidate = candidates.find((candidate) => candidate.id === identity.id);
  expect(candidate).toBeDefined();
  expect(candidate!.email).toBe("");
  const candidateName = [candidate!.first_name, candidate!.last_name].filter(Boolean).join(" ");
  expect(candidateName).toBe(searchName);
  await page
    .getByRole("group", { name: "Matching users", exact: true })
    .getByRole("button")
    .filter({ has: page.getByText(candidateName, { exact: true }) })
    .click();
  await expect(picker).toHaveValue(candidateName);
  const reviewing = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/events/${slug}/agenda/transfers/reviews`,
  );
  await page.getByRole("button", { name: "Review import", exact: true }).click();
  const reviewResponse = await reviewing;
  expect(reviewResponse.status()).toBe(200);
  const prepared = transferPrepareSchema.parse(reviewResponse.request().postDataJSON());
  expect(prepared.resolutions.people[person!.ref]).toEqual({ userId: identity.id, actingIdentityId: null });
  const review = transferReviewSchema.parse(await reviewResponse.json());
  expect(review.ready).toBe(true);
  const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-transfer";
  await mkdir(artifacts, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/reviewed-import-phone.png`, fullPage: true });
  await page
    .getByRole("checkbox", { name: "Timing review I reviewed inferred end times and transitions.", exact: true })
    .check();
  const applying = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/events/${slug}/agenda/transfers`,
  );
  await page.getByRole("button", { name: "Apply to draft", exact: true }).click();
  const appliedResponse = await applying;
  expect(appliedResponse.status()).toBe(200);
  const command = transferApplySchema.parse(appliedResponse.request().postDataJSON());
  expect(command.reviewDigest).toBe(review.digest);
  expect(command.expectedRevision).toBe(snapshot.revision);
  expect(command.resolutions).toEqual(prepared.resolutions);
  const applied = transferApplyResponseSchema.parse(await appliedResponse.json());
  await expect(page.getByRole("region", { name: "Review versioned agenda import" })).toHaveCount(0);
  const updated = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  expect(updated).toEqual(applied.agenda);
  expect(updated.publishedRevision).toBe(snapshot.publishedRevision);
  expect(updated.revision).toBeGreaterThan(snapshot.revision);
  expect(updated.occurrences.find((r) => r.title === "Reviewed portable browser copy")).toMatchObject({
    startAt: null,
    roomId: null,
    visibility: "private",
  });
});

test("agenda import CLI reviews and applies through the real API without publishing", async ({ page }, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-transfer-cli"));
  const before = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const title = "CLI source session";
  const created = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: before.revision,
      title,
      startAt: null,
      endAt: null,
      roomId: null,
      speakerUserIds: [],
    }),
  });
  expect(created.status()).toBe(200);
  const source = agendaSnapshotSchema.parse(await created.json());
  const document = agendaTransferSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda/transfers/exports?limit=100`)).json(),
  );
  document.occurrences = document.occurrences.filter((row) => row.fields.title === title);
  expect(document.occurrences).toHaveLength(1);
  document.occurrences[0]!.fields.title = "Imported through temporary CLI";
  document.people = [];
  const token = (await page.context().cookies()).find((cookie) => cookie.name === USER_SESSION_COOKIE_NAME)?.value;
  expect(Boolean(token)).toBe(true);
  await mkdir(testInfo.outputDir, { recursive: true });
  const input = testInfo.outputPath("prepared-agenda.json");
  await writeFile(input, JSON.stringify(agendaTransferSchema.parse(document)));
  const args = [
    "--experimental-strip-types",
    "scripts/import-agenda.mjs",
    "--base-url",
    new URL(page.url()).origin,
    "--event",
    slug,
    "--document",
    input,
    "--mode",
    "copy_as_new",
    "--acknowledge-inferred-timing",
    "--acknowledge-archive-representation",
  ];
  const execute = promisify(execFile);
  const options = { env: { ...process.env, PKIC_AGENDA_IMPORT_TOKEN: token }, timeout: 30000 };
  const review = await execute(process.execPath, args, options);
  expect(review.stdout).not.toContain(token!);
  expect(agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json())).toEqual(
    source,
  );
  await execute(process.execPath, [...args, "--apply"], options);
  const applied = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  expect(applied.revision).toBe(source.revision + 1);
  expect(applied.publishedRevision).toBe(source.publishedRevision);
  expect(applied.occurrences.filter((row) => row.title === "Imported through temporary CLI")).toHaveLength(1);
  expect(applied.occurrences.find((row) => row.title === "Imported through temporary CLI")).toMatchObject({
    visibility: "private",
    startAt: null,
    endAt: null,
    roomId: null,
  });
  await execute(process.execPath, [...args, "--apply"], options);
  const replayed = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  expect(replayed.occurrences).toEqual(applied.occurrences);
  expect(replayed.publishedRevision).toBe(source.publishedRevision);
});
