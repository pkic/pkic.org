import { expect, type Locator, type Page } from "@playwright/test";
import {
  agendaImportResponseSchema,
  agendaImportSchema,
  agendaSnapshotSchema,
} from "../../../assets/shared/schemas/event-agenda";
import {
  agendaScheduleApplySchema,
  agendaScheduleProposalSchema,
  agendaScheduleReviewSchema,
} from "../../../assets/shared/schemas/event-agenda-schedule";
import { formatTimeRangeInZone } from "../../../assets/shared/format-date";
import { agendaContent } from "../../../assets/shared/public-agenda-content";
import { instantToDateTimeLocal } from "../../../assets/shared/timezone";

type Activation = "keyboard" | "touch" | "pointer";

async function activate(control: Locator, mode: Activation) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  if (mode === "touch") await control.tap();
  else if (mode === "pointer") await control.click();
  else {
    await control.focus();
    await control.press("Enter");
  }
}

async function rowAction(page: Page, row: Locator, action: string, mode: Activation) {
  await activate(row.getByRole("button", { name: /^Actions for / }), mode);
  await activate(page.getByRole("menuitem", { name: action, exact: true }), mode);
}

/** Native input starts only over the real visible draggable owner, never outside the viewport. */
export async function startPlacementDrag(page: Page, source: Locator) {
  await source.scrollIntoViewIfNeeded();
  await expect(source).toBeVisible();
  const origin = await source.boundingBox();
  if (!origin) throw new Error("Native drag source has no pointer geometry");
  expect(
    await source.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const owner = element.closest('[draggable="true"]');
      return (
        x >= 0 &&
        x < innerWidth &&
        y >= 0 &&
        y < innerHeight &&
        owner !== null &&
        hit?.closest('[draggable="true"]') === owner
      );
    }),
    "The native drag origin must hit its visible draggable owner",
  ).toBe(true);
  const scheduledSource = await source.evaluate((element) => {
    const owner = element.closest("[data-agenda-occurrence]");
    if (!owner) return null;
    const rect = owner.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
  // Observe the genuine source through native drag; diagnostics do not select or mutate the board.
  await source.evaluate((element) => {
    const owner = element.closest('[draggable="true"]');
    if (!owner) throw new Error("Native drag owner disappeared before input");
    const parent = owner.parentElement;
    const journal = Reflect.get(window, "acceptedPlacementDragJournal") as unknown[];
    let removedAncestor = false;
    let removals = 0;
    const observeRemovals = (records: MutationRecord[]) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node === owner || node.contains(owner)) {
            removedAncestor = true;
            removals++;
          }
        }
      }
    };
    const observer = new MutationObserver(observeRemovals);
    observer.observe(document.body, { childList: true, subtree: true });
    const record = (type: string, event?: Event) => {
      observeRemovals(observer.takeRecords());
      const rect = owner.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      journal.push({
        type: `native-source-${type}`,
        occurrenceId: owner.getAttribute("data-agenda-occurrence"),
        isConnected: owner.isConnected,
        sameParent: owner.parentElement === parent,
        removedAncestor,
        removals,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        centerHitsOwner: hit?.closest('[draggable="true"]') === owner,
        defaultPrevented: event?.defaultPrevented,
      });
    };
    const listen = (event: Event) => {
      if (!(event.target instanceof Node) || !owner.contains(event.target)) return;
      record(event.type, event);
      queueMicrotask(() => record(`${event.type}-microtask`, event));
      requestAnimationFrame(() => {
        record(`${event.type}-frame`, event);
        if (event.type === "dragend") {
          observer.disconnect();
          document.removeEventListener("dragstart", listen, true);
          document.removeEventListener("dragend", listen, true);
        }
      });
    };
    document.addEventListener("dragstart", listen, true);
    document.addEventListener("dragend", listen, true);
    record("before");
  });
  await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
  await page.mouse.down();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      page.mouse.move(origin.x + origin.width / 2 + 12, origin.y + origin.height / 2 + 12, { steps: 5 }),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Native drag initialization stalled for 30 seconds; inspect the source drag journal")),
          30_000,
        );
      }),
    ]);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
  if (scheduledSource) {
    expect(
      await source.evaluate((element) => {
        const owner = element.closest("[data-agenda-occurrence]")!;
        const rect = owner.getBoundingClientRect();
        return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
      }),
      "Revealing native destinations must preserve the scheduled source geometry",
    ).toEqual(scheduledSource);
  }
}

export async function readPlacementAgenda(page: Page, endpoint: string) {
  const response = await page.request.get(endpoint);
  expect(response.status()).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}

/** Real menu/candidate activation completes the same reviewed import used by native drag. */
export async function completeAcceptedPlacement(
  page: Page,
  endpoint: string,
  title: string,
  startAt: string,
  endAt: string,
  mode: "keyboard" | "touch",
) {
  const before = await readPlacementAgenda(page, endpoint);
  const room = before.rooms.find((value) => value.name === "Workshop")!;
  expect(room).toBeDefined();
  const row = page
    .getByRole("table", { name: "Accepted proposals", exact: true })
    .getByRole("row")
    .filter({ hasText: title });
  await rowAction(page, row, "Schedule on agenda", mode);
  const candidateAt = agendaContent(before, true).days[0]?.slots[0]?.startsAt;
  expect(candidateAt, "The current canonical board must provide a scheduling candidate").toBeDefined();
  const candidate = page
    .getByRole("button", {
      name: `Schedule selected proposal at ${formatTimeRangeInZone(candidateAt!, undefined, before.timeZone)} in Workshop`,
      exact: true,
    })
    .first();
  await activate(candidate, mode);
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    instantToDateTimeLocal(candidateAt!, before.timeZone),
  );
  await expect(page.getByLabel("Location", { exact: true })).toHaveValue(room.id);
  await expect(page.getByRole("button", { name: "Save placement", exact: true })).toBeDisabled();
  await page.getByLabel("Start time", { exact: true }).fill(instantToDateTimeLocal(startAt, before.timeZone));
  await page.getByLabel("End time", { exact: true }).fill(instantToDateTimeLocal(endAt, before.timeZone));
  const reviewing = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${endpoint}/imports` && response.request().method() === "POST",
  );
  await activate(page.getByRole("button", { name: "Review placement", exact: true }), mode);
  const review = await reviewing;
  expect(review.status(), await review.text()).toBe(200);
  const reviewed = agendaImportSchema.parse(review.request().postDataJSON());
  const preview = agendaImportResponseSchema.parse(await review.json());
  expect(reviewed.dryRun).toBe(true);
  expect(reviewed.expectedRevision).toBe(before.revision);
  expect(reviewed.proposalIds).toHaveLength(1);
  expect(reviewed.proposalPlacement).toMatchObject({ startAt, endAt, roomId: room.id });
  await expect(page.getByText("Placement reviewed.", { exact: false })).toBeVisible();
  expect(await readPlacementAgenda(page, endpoint)).toEqual(before);
  const applying = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${endpoint}/imports` && response.request().method() === "POST",
  );
  await activate(page.getByRole("button", { name: "Save placement", exact: true }), mode);
  const applied = await applying;
  expect(applied.status(), await applied.text()).toBe(200);
  const command = agendaImportSchema.parse(applied.request().postDataJSON());
  expect(command.dryRun).toBe(false);
  expect(command.proposalIds).toEqual(reviewed.proposalIds);
  expect(command.proposalPlacement).toEqual(reviewed.proposalPlacement);
  expect(command.expectedPlacementFingerprint).toBe(preview.placementFingerprint);
  await expect(page.getByLabel("End time", { exact: true })).toHaveCount(0);
  const after = await readPlacementAgenda(page, endpoint);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.occurrences).toHaveLength(before.occurrences.length + 1);
  expect(after.occurrences.find((value) => value.title === title)).toMatchObject({ startAt, endAt, roomId: room.id });
  for (const prior of before.occurrences)
    expect(after.occurrences.find((value) => value.id === prior.id)).toEqual(prior);
}

/** Drag a real card, or activate its equivalent menu; cancel and then apply the exact same candidate. */
export async function movePlacedSession(
  page: Page,
  endpoint: string,
  title: string,
  startAt: string,
  mode: Activation,
) {
  const before = await readPlacementAgenda(page, endpoint);
  const original = before.occurrences.find((value) => value.title === title)!;
  const room = before.rooms.find((value) => value.name === "Second workshop")!;
  expect(original.startAt).not.toBeNull();
  expect(original.endAt).not.toBeNull();
  expect(room).toBeDefined();
  expect(original.roomId).not.toBe(room.id);
  expect(original.startAt).not.toBe(startAt);
  const duration = Date.parse(original.endAt!) - Date.parse(original.startAt!);
  const endAt = new Date(Date.parse(startAt) + duration).toISOString();
  const candidateName = `Move selected session at ${formatTimeRangeInZone(startAt, undefined, before.timeZone)} in ${room.name}`;
  await page.getByLabel("Scheduling time step", { exact: true }).selectOption("15");
  for (const commit of [false, true]) {
    const journalStart = await page.evaluate(() => {
      const journal = Reflect.get(window, "acceptedPlacementDragJournal");
      return Array.isArray(journal) ? journal.length : 0;
    });
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .first();
    if (mode === "pointer") {
      const heading = card.getByRole("heading", { name: title, exact: true });
      await startPlacementDrag(page, heading);
    } else await rowAction(page, card, "Select for move", mode);
    const destination = page.getByRole("button", { name: candidateName, exact: true }).first();
    await expect(destination).toBeVisible();
    await expect(destination).toBeEnabled();
    expect(await readPlacementAgenda(page, endpoint)).toEqual(before);
    const reviewing = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/schedule/reviews` && response.request().method() === "POST",
    );
    if (mode === "pointer") {
      await destination.scrollIntoViewIfNeeded();
      const target = await destination.boundingBox();
      if (!target) throw new Error("Move destination has no native pointer geometry");
      expect(
        await destination.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }),
      ).toBe(true);
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
      await page.mouse.up();
    } else await activate(destination, mode);
    const response = await reviewing;
    expect(response.status(), await response.text()).toBe(200);
    if (mode === "pointer") {
      expect(
        await page.evaluate(
          ({ from, id }) => {
            const journal = Reflect.get(window, "acceptedPlacementDragJournal") as Array<{
              type: string;
              sessionPayload?: string;
            }>;
            const events = journal.slice(from);
            return {
              started: events.some((event) => event.type === "dragstart"),
              dropped: events.some((event) => event.type === "drop" && event.sessionPayload === id),
            };
          },
          { from: journalStart, id: original.id },
        ),
      ).toEqual({ started: true, dropped: true });
    }
    const request = agendaScheduleProposalSchema.parse(response.request().postDataJSON());
    const review = agendaScheduleReviewSchema.parse(await response.json());
    expect(request.expectedRevision).toBe(before.revision);
    expect(request.changes).toEqual([{ id: original.id, startAt, endAt, roomId: room.id, additionalRoomIds: [] }]);
    expect(review.affected).toHaveLength(1);
    expect(review.affected[0]!.before).toEqual(original);
    expect(review.affected[0]!.after).toMatchObject({ id: original.id, startAt, endAt, roomId: room.id });
    await expect(page.getByRole("heading", { name: "Review schedule changes", exact: true })).toBeVisible();
    expect(await readPlacementAgenda(page, endpoint)).toEqual(before);
    if (!commit) {
      await activate(page.getByRole("button", { name: "Cancel schedule changes", exact: true }), mode);
      await expect(page.getByRole("heading", { name: "Review schedule changes", exact: true })).toHaveCount(0);
      expect(await readPlacementAgenda(page, endpoint)).toEqual(before);
      continue;
    }
    const applying = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/schedule` && response.request().method() === "POST",
    );
    await activate(page.getByRole("button", { name: "Apply reviewed schedule", exact: true }), mode);
    const applied = await applying;
    expect(applied.status(), await applied.text()).toBe(200);
    const command = agendaScheduleApplySchema.parse(applied.request().postDataJSON());
    expect(command.expectedRevision).toBe(before.revision);
    expect(command.changes).toEqual(request.changes);
    expect(command.reviewHash).toBe(review.reviewHash);
    await expect(page.getByRole("heading", { name: "Review schedule changes", exact: true })).toHaveCount(0);
    const after = await readPlacementAgenda(page, endpoint);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.occurrences).toHaveLength(before.occurrences.length);
    expect(after.occurrences.find((value) => value.id === original.id)).toMatchObject({
      startAt,
      endAt,
      roomId: room.id,
    });
    for (const prior of before.occurrences.filter((value) => value.id !== original.id))
      expect(after.occurrences.find((value) => value.id === prior.id)).toEqual(prior);
  }
}
