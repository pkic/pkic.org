import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type APIResponse } from "@playwright/test";
import {
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  type AgendaSnapshot,
} from "../../assets/shared/schemas/event-agenda";
import {
  agendaContentPlacementSchema,
  agendaContentPlacementResponseSchema,
} from "../../assets/shared/schemas/event-agenda-content";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
} from "../../assets/shared/schemas/event-agenda-transfer";
import {
  sessionAppearanceSchema,
  sessionHistoryMetadataSchema,
  sessionHistoryCorrectionSchema,
  type SessionAppearance,
} from "../../assets/shared/schemas/event-session-history";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../assets/shared/schemas/group-events";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import {
  identityCreateSchema,
  identityUpdateSchema,
  identityMutationResponseSchema,
} from "../../assets/shared/schemas/identity";
import {
  userUpdateSchema,
  userUpdateResponseSchema,
  userDetailResponseSchema,
} from "../../assets/shared/schemas/user-management";
import { dateTimeLocalToIso } from "../../assets/shared/timezone";
import { canonicalSessionCredits } from "../../assets/shared/session-public-credits";
import { agendaSessionContent } from "../../assets/shared/public-agenda-content";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { publishE2eSite } from "./helpers/site-publication";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const personName = "Synthetic archive continuity speaker";
const description =
  "An explicitly reviewed synthetic session about preserving attributed program history across repeated appearances and later profile corrections.";
const roleA = "Employer A research lead";
const roleB = "Employer B engineering director";
const biographyA = "Reviewed biography for the first employer and both repeated appearances.";
const biographyB = "Reviewed biography for the second employer at the later event.";
test.use({ actionTimeout: 20_000 });

async function accepted(response: APIResponse, status = 200) {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return JSON.parse(text) as unknown;
}

function occurrence(agenda: AgendaSnapshot, id: string) {
  const result = agenda.occurrences.find((item) => item.id === id);
  expect(result, `Expected canonical occurrence ${id}`).toBeDefined();
  return result!;
}

// Synthetic authored input proves the workflow; it is not evidence of historical human rights approval.
test("public repeats retain event-specific employer credits through profile edits and one reviewed correction", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000);
  await mkdir(info.outputDir, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail());
  const suffix = randomUUID().slice(0, 8);
  const organizationA = organizationCreateResponseSchema.parse(
    await accepted(
      await page.request.post("/api/v1/organizations", {
        data: organizationCreateSchema.parse({
          name: `Synthetic employer A ${suffix}`,
          membershipCategory: "F",
          memberSince: "2026-01-01",
          identities: [
            { name: personName, email: `history-${randomUUID()}@example.test`, jobTitle: roleA, biography: biographyA },
          ],
          activationReason: "Activate a synthetic speaker for explicit archive continuity review.",
        }),
      }),
      201,
    ),
  ).organization;
  expect(organizationA.identities).toHaveLength(1);
  const { userId, identityId: identityA } = organizationA.identities[0]!;
  const organizationB = organizationCreateResponseSchema.parse(
    await accepted(
      await page.request.post("/api/v1/organizations", {
        data: organizationCreateSchema.parse({
          name: `Synthetic employer B ${suffix}`,
          membershipCategory: "F",
          memberSince: "2026-01-01",
        }),
      }),
      201,
    ),
  ).organization;
  const secondIdentity = identityMutationResponseSchema.parse(
    await accepted(
      await page.request.post(`/api/v1/organizations/${organizationB.id}/identities`, {
        data: identityCreateSchema.parse({
          userReference: "existing_user",
          userId,
          activation: {
            mode: "immediate",
            reason: "Explicitly link the same synthetic person to the second employer.",
          },
          jobTitle: roleB,
          biography: biographyB,
        }),
      }),
      201,
    ),
  );
  expect(secondIdentity.state).toBe("active");
  expect(secondIdentity.identityId).not.toBe(identityA);
  const days = [30, 31].map((offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10));
  const stamp = (day: string, time: string) => dateTimeLocalToIso(`${day}T${time}`, "Etc/UTC");
  const read = async (slug: string, approved = false) =>
    agendaSnapshotSchema.parse(
      await accepted(
        await page.request.get(`/api/v1/events/${slug}/agenda${approved ? "/previews?revision=approved" : ""}`),
      ),
    );
  const importEvent = async (index: number, identityId: string) => {
    const day = days[index]!;
    const slug = `history-continuity-${suffix}-${index}`;
    const created = groupEventDetailResponseSchema.parse(
      await accepted(
        await page.request.post("/api/v1/groups/20000000-0000-4000-8000-000000000003/events", {
          data: groupEventCreateSchema.parse({
            slug,
            name: `Synthetic history event ${index + 1} ${suffix}`,
            timezone: "Etc/UTC",
            startsAt: stamp(day, "09:00"),
            endsAt: stamp(day, "17:00"),
            profileKey: "conference",
            registrationPolicy: "no_registration",
            visibility: "public",
            links: [],
          }),
        }),
        201,
      ),
    ).event;
    const endpoint = `/api/v1/events/${slug}/agenda`;
    const withRoom = agendaSnapshotSchema.parse(
      await accepted(
        await page.request.post(`${endpoint}/rooms`, {
          data: agendaRoomCreateSchema.parse({
            expectedRevision: (await read(slug)).revision,
            name: "Continuity review hall",
            capacity: 100,
          }),
        }),
      ),
    );
    expect(withRoom.rooms).toHaveLength(1);
    const roomId = withRoom.rooms[0]!.id;
    const authored = {
      title: "Repeated trust history session",
      description,
      day,
      personRef: "reviewed-person",
      roomRef: "reviewed-room",
    };
    const sourceDigest = digest(JSON.stringify(authored));
    const sourceKey = `synthetic-history:${suffix}:${index}`;
    const document = agendaTransferSchema.parse({
      format: "pkic-agenda",
      version: 1,
      source: { kind: "hugo", eventRef: slug, exportedAt: new Date().toISOString(), sourceDigest },
      people: [
        {
          ref: authored.personRef,
          label: personName,
          canonicalUserId: userId,
          actingIdentityId: identityId,
          role: "speaker",
        },
      ],
      rooms: [{ ref: authored.roomRef, label: "Continuity review hall", canonicalRoomId: roomId }],
      occurrences: [
        {
          ref: sourceKey,
          sourceKey,
          sourceAnchor: null,
          sourcePath: `/events/${slug}/`,
          sourceDigest,
          fields: { title: authored.title, description, kind: "session", visibility: "public" },
          timing: {
            timeZone: "Etc/UTC",
            authoredDate: day,
            authoredStart: "10:00",
            startAt: stamp(day, "10:00"),
            endAt: stamp(day, "10:30"),
            endSource: "explicit",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          roomRefs: [authored.roomRef],
          personRefs: [authored.personRef],
          personRoles: { [authored.personRef]: "speaker" },
          retainedSourceEvidence: [],
          media: [],
          archive: sessionHistoryMetadataSchema.parse({ prerequisites: "Synthetic reviewed continuity fixture." }),
        },
      ],
    });
    const prepared = transferPrepareSchema.parse({
      expectedRevision: withRoom.revision,
      mode: "archive",
      document,
      resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    });
    const review = transferReviewSchema.parse(
      await accepted(await page.request.post(`${endpoint}/transfers/reviews`, { data: prepared })),
    );
    expect(review.ready, JSON.stringify(review.findings)).toBe(true);
    const applied = transferApplyResponseSchema.parse(
      await accepted(
        await page.request.post(`${endpoint}/transfers`, {
          data: transferApplySchema.parse({
            ...prepared,
            reviewDigest: review.digest,
            acknowledgeInferredTiming: true,
            acknowledgeArchiveRepresentation: true,
          }),
        }),
      ),
    );
    expect(applied.imported).toBe(1);
    expect(applied.agenda.occurrences).toHaveLength(1);
    const session = applied.agenda.occurrences[0]!;
    expect(session.speakers.map((speaker) => speaker.userId)).toEqual([userId]);
    expect(session.history?.appearances).toEqual([]);
    expect(session.history?.materials).toEqual([]);
    expect(applied.agenda.publishedRevision).toBeNull();
    return { slug, endpoint, day, roomId, eventId: created.id, originalId: session.id };
  };
  const eventA = await importEvent(0, identityA);
  const eventB = await importEvent(1, secondIdentity.identityId);
  const placed = agendaContentPlacementResponseSchema.parse(
    await accepted(
      await page.request.post(`${eventA.endpoint}/occurrences/${eventA.originalId}/placements`, {
        data: agendaContentPlacementSchema.parse({
          expectedRevision: (await read(eventA.slug)).revision,
          copyAsNew: false,
        }),
      }),
    ),
  );
  const repeatedId = placed.occurrenceId;
  expect(repeatedId).not.toBe(eventA.originalId);
  expect(occurrence(placed.agenda, eventA.originalId).contentId).toBe(placed.contentId);
  expect(occurrence(placed.agenda, repeatedId).contentId).toBe(placed.contentId);
  expect(occurrence(placed.agenda, repeatedId).history?.appearances ?? []).toEqual([]);
  expect(occurrence(placed.agenda, repeatedId).history?.materials ?? []).toEqual([]);
  agendaSnapshotSchema.parse(
    await accepted(
      await page.request.patch(`${eventA.endpoint}/occurrences/${repeatedId}`, {
        data: agendaOccurrencePatchSchema.parse({
          expectedRevision: placed.agenda.revision,
          startAt: stamp(eventA.day, "11:00"),
          endAt: stamp(eventA.day, "11:30"),
          roomId: eventA.roomId,
          visibility: "public",
        }),
      }),
    ),
  );
  const creditA = sessionAppearanceSchema.parse({
    userId,
    actingIdentityId: identityA,
    displayName: personName,
    jobTitle: roleA,
    organizationName: organizationA.name,
    biography: biographyA,
    photoUrl: null,
    approvedAt: new Date().toISOString(),
  });
  const creditB = sessionAppearanceSchema.parse({
    ...creditA,
    actingIdentityId: secondIdentity.identityId,
    jobTitle: roleB,
    organizationName: organizationB.name,
    biography: biographyB,
  });
  const saveCredit = async (event: typeof eventA, id: string, credit: SessionAppearance, expectedRevision?: number) => {
    const current = await read(event.slug);
    return page.request.post(`${event.endpoint}/occurrences/${id}/history`, {
      data: sessionHistoryCorrectionSchema.parse({
        expectedRevision: expectedRevision ?? current.revision,
        history: { ...occurrence(current, id).history, appearances: [credit] },
      }),
    });
  };
  for (const id of [eventA.originalId, repeatedId])
    agendaSnapshotSchema.parse(await accepted(await saveCredit(eventA, id, creditA)));
  agendaSnapshotSchema.parse(await accepted(await saveCredit(eventB, eventB.originalId, creditB)));
  const approve = async (event: typeof eventA) =>
    agendaSnapshotSchema.parse(
      await accepted(
        await page.request.post(`${event.endpoint}/publications`, {
          data: agendaRevisionSchema.parse({ expectedRevision: (await read(event.slug)).revision }),
        }),
      ),
    );
  await approve(eventA);
  await approve(eventB);
  const frozenA = structuredClone(await read(eventA.slug, true));
  const frozenB = structuredClone(await read(eventB.slug, true));
  expect(frozenA.occurrences.map((item) => item.id).sort()).toEqual([eventA.originalId, repeatedId].sort());
  expect(occurrence(frozenA, eventA.originalId).history!.appearances).toEqual([creditA]);
  expect(occurrence(frozenA, repeatedId).history!.appearances).toEqual([creditA]);
  expect(occurrence(frozenB, eventB.originalId).history!.appearances).toEqual([creditB]);
  const personPath = `/people/${userId}/`;
  const paths = [eventA.originalId, repeatedId].map((id) => `/events/${eventA.slug}/sessions/${id}/`);
  paths.push(`/events/${eventB.slug}/sessions/${eventB.originalId}/`);
  expect(new Set(paths).size).toBe(3);
  const publicContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
  });
  const apiRequests: string[] = [];
  await publicContext.route("**/api/**", async (route) => {
    apiRequests.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  const publicPage = await publicContext.newPage();
  const releases: string[] = [];
  const checkPublic = async (corrected = false) => {
    const personResponse = await publicPage.goto(personPath);
    expect(personResponse?.status()).toBe(200);
    const history = publicPage.locator("article[data-pagefind-body]");
    await expect(history.getByRole("heading", { level: 1 })).toHaveText(personName);
    await expect(history.getByRole("heading", { name: "Speaking history", level: 2, exact: true })).toBeVisible();
    const appearances = history.getByRole("list").filter({ has: publicPage.locator(`a[href="${paths[0]}"]`) });
    await expect(appearances).toHaveCount(1);
    await expect(appearances.getByRole("listitem")).toHaveCount(3);
    await expect(history).not.toContainText("Later current profile");
    for (const [index, path] of paths.entries()) {
      const link = appearances.locator(`a[href="${path}"]`);
      await expect(link).toHaveCount(1);
      await expect(link.locator("xpath=ancestor::li")).toContainText(
        index === 2 ? organizationB.name : organizationA.name,
      );
      await expect(link.locator("xpath=ancestor::li")).toContainText(
        index === 2 ? roleB : corrected && index === 0 ? "Reviewed occurrence correction" : roleA,
      );
    }
    for (const [index, path] of paths.entries()) {
      const response = await publicPage.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["x-pkic-publication"]).toBe(`static; snapshot=${releases.at(-1)}`);
      const article = publicPage.locator("article[data-pagefind-body]");
      await expect(article.locator(`a[href="${personPath}"]`)).toHaveCount(1);
      await expect(article).toContainText(index === 2 ? organizationB.name : organizationA.name);
      await expect(article).toContainText(
        index === 2 ? roleB : corrected && index === 0 ? "Reviewed occurrence correction" : roleA,
      );
      await expect(article).toContainText(
        index === 2
          ? biographyB
          : corrected && index === 0
            ? "Explicitly reviewed correction for this occurrence only."
            : biographyA,
      );
      await expect(article).not.toContainText("Later current profile");
      await expect(article).not.toContainText(index === 2 ? organizationA.name : organizationB.name);
    }
    expect(apiRequests).toEqual([]);
  };
  const capture = async (label: string, path: string) => {
    for (const [device, viewport] of Object.entries({
      desktop: { width: 1280, height: 900 },
      phone: { width: 390, height: 844 },
    })) {
      await publicPage.setViewportSize(viewport);
      await publicPage.goto(path);
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await publicPage.screenshot({ path: info.outputPath(`${label}-${device}.png`), fullPage: true });
    }
  };
  const publish = async () => {
    const release = await publishE2eSite(page, personPath);
    const publishedA = release.snapshot.eventAgendas?.[eventA.slug];
    const publishedB = release.snapshot.eventAgendas?.[eventB.slug];
    expect(publishedA).toBeDefined();
    expect(publishedB).toBeDefined();
    expect(publishedA!.publicAgendaPath).toBe(`/events/2026/${eventA.slug}/agenda/`);
    expect(publishedA!.occurrences.map((item) => item.id).sort()).toEqual([eventA.originalId, repeatedId].sort());
    expect(publishedB!.occurrences.map((item) => item.id)).toEqual([eventB.originalId]);
    releases.push(release.snapshotId);
  };
  try {
    await publish();
    await checkPublic();
    await publicPage.goto(`/events/2026/${eventA.slug}/agenda/`);
    for (const id of [eventA.originalId, repeatedId])
      await expect(publicPage.locator(`article[data-agenda-occurrence="${id}"]`)).toHaveCount(1);
    await capture("public-repeated-agenda", `/events/2026/${eventA.slug}/agenda/`);
    await capture("public-two-employer-history", personPath);
    userUpdateResponseSchema.parse(
      await accepted(
        await page.request.patch(`/api/v1/users/${userId}`, {
          data: userUpdateSchema.parse({ preferredName: "Later current profile name" }),
        }),
      ),
    );
    identityMutationResponseSchema.parse(
      await accepted(
        await page.request.patch(`/api/v1/organizations/${organizationA.id}/identities/${identityA}`, {
          data: identityUpdateSchema.parse({
            profile: { jobTitle: "Later current profile role", biography: "Later current profile biography" },
          }),
        }),
      ),
    );
    const currentPerson = userDetailResponseSchema.parse(
      await accepted(await page.request.get(`/api/v1/users/${userId}`)),
    ).user;
    expect(currentPerson.id).toBe(userId);
    expect(currentPerson.preferred_name).toBe("Later current profile name");
    const currentIdentity = currentPerson.identities.find((identity) => identity.identityId === identityA);
    expect(currentIdentity?.jobTitle).toBe("Later current profile role");
    expect(await read(eventA.slug, true)).toEqual(frozenA);
    expect(await read(eventB.slug, true)).toEqual(frozenB);
    for (const id of [eventA.originalId, repeatedId])
      expect(occurrence(await read(eventA.slug), id).history!.appearances).toEqual([creditA]);
    await publish();
    await checkPublic();
    const current = await read(eventA.slug);
    const correctedCredit = sessionAppearanceSchema.parse({
      ...creditA,
      jobTitle: "Reviewed occurrence correction",
      biography: "Explicitly reviewed correction for this occurrence only.",
      approvedAt: new Date().toISOString(),
    });
    const corrected = agendaSnapshotSchema.parse(
      await accepted(await saveCredit(eventA, eventA.originalId, correctedCredit, current.revision)),
    );
    expect(corrected.revision).toBe(current.revision + 1);
    expect(corrected.publishedRevision).toBe(frozenA.revision);
    expect(occurrence(corrected, eventA.originalId).history!.appearances).toEqual([correctedCredit]);
    expect(occurrence(corrected, repeatedId).history).toEqual(occurrence(current, repeatedId).history);
    expect(occurrence(corrected, eventA.originalId).contentId).toBe(placed.contentId);
    expect(occurrence(corrected, repeatedId).contentId).toBe(placed.contentId);
    expect(await read(eventA.slug, true)).toEqual(frozenA);
    await checkPublic();
    const stale = await saveCredit(eventA, eventA.originalId, creditA, current.revision);
    expect(stale.status()).toBe(409);
    expect(await read(eventA.slug)).toEqual(corrected);
    const approvedCorrection = await approve(eventA);
    expect(approvedCorrection.occurrences.map((item) => item.id).sort()).toEqual(
      frozenA.occurrences.map((item) => item.id).sort(),
    );
    const newlyApproved = await read(eventA.slug, true);
    const repeated = occurrence(newlyApproved, repeatedId);
    const originalRepeat = occurrence(frozenA, repeatedId);
    expect(repeated.publicationStatus).toBe("changed");
    expect(repeated.speakers).toEqual([{ userId, role: "speaker", displayName: "Later current profile name" }]);
    expect(repeated).toEqual({
      ...originalRepeat,
      publicationStatus: "changed",
      speakers: originalRepeat.speakers.map((speaker) => ({ ...speaker, displayName: "Later current profile name" })),
    });
    expect(repeated.history).toEqual(originalRepeat.history);
    expect(canonicalSessionCredits(repeated)).toEqual(canonicalSessionCredits(originalRepeat));
    expect(agendaSessionContent(newlyApproved, repeated)).toEqual(agendaSessionContent(frozenA, originalRepeat));
    expect(await read(eventB.slug, true)).toEqual(frozenB);
    await publish();
    await checkPublic(true);
    await capture("public-scoped-credit-correction", paths[0]!);
    await writeFile(
      info.outputPath("speaker-history-lifecycle-receipt.json"),
      JSON.stringify(
        {
          scope:
            "Synthetic canonical identity, approved repeat and two-event credits, fresh static rebuild, explicit one-occurrence correction; no physical-device or historical rights acceptance.",
          userId,
          identityIds: [identityA, secondIdentity.identityId],
          eventIds: [eventA.eventId, eventB.eventId],
          paths,
          personPath,
          contentId: placed.contentId,
          occurrenceIds: [eventA.originalId, repeatedId, eventB.originalId],
          originalCredits: [creditA, creditB],
          correctedCredit,
          releases,
          apiRequests,
          originalRevisions: [frozenA.revision, frozenB.revision],
          correctedRevision: approvedCorrection.revision,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await publicContext.close();
  }
});
