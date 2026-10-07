import { expect, type Locator, type Page } from "@playwright/test";
import {
  agendaImportResponseSchema,
  agendaImportSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../assets/shared/schemas/event-agenda";
import {
  agendaScheduleApplySchema,
  agendaScheduleProposalSchema,
  agendaScheduleReviewSchema,
} from "../../../assets/shared/schemas/event-agenda-schedule";
import { formatTimeRangeInZone } from "../../../assets/shared/format-date";
import { instantToDateTimeLocal } from "../../../assets/shared/timezone";

export async function expectUnclippedAgendaLink(link: Locator) {
  const geometry = await link.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const clipped: string[] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const bounds = parent.getBoundingClientRect(),
        style = getComputedStyle(parent);
      const left = bounds.left + parent.clientLeft,
        top = bounds.top + parent.clientTop;
      const clipX = parent.matches("article") || style.overflowX !== "visible";
      const clipY = parent.matches("article") || style.overflowY !== "visible";
      if (clipX && (rect.left < left - 1 || rect.right > left + parent.clientWidth + 1))
        clipped.push(`${parent.className}:x`);
      if (clipY && (rect.top < top - 1 || rect.bottom > top + parent.clientHeight + 1))
        clipped.push(`${parent.className}:y`);
    }
    if (!clipped.length) window.scrollBy({ top: rect.top + rect.height / 2 - innerHeight / 2, behavior: "instant" });
    const visible = element.getBoundingClientRect(),
      hit = document.elementFromPoint(visible.left + visible.width / 2, visible.top + visible.height / 2);
    return { clipped, hit: hit !== null && element.contains(hit) };
  });
  expect(geometry.clipped).toEqual([]);
  expect(geometry.hit).toBe(true);
}

/** Observe the actual UI command through its canonical review and guarded apply receipts. */
export async function commitScheduleCommand(
  page: Page,
  slug: string,
  before: AgendaSnapshot,
  perform: () => Promise<void>,
) {
  const endpoint = `/api/v1/events/${slug}/agenda/schedule`;
  const reviewing = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === `${endpoint}/reviews`,
    )
    .then(async (response) => {
      expect(response.status()).toBe(200);
      return {
        request: agendaScheduleProposalSchema.parse(response.request().postDataJSON()),
        review: agendaScheduleReviewSchema.parse(await response.json()),
      };
    });
  const applying = page
    .waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === endpoint,
    )
    .then(async (response) => {
      expect(response.status()).toBe(200);
      return {
        command: agendaScheduleApplySchema.parse(response.request().postDataJSON()),
        agenda: agendaSnapshotSchema.parse(await response.json()),
      };
    });
  const [reviewed, applied] = await Promise.all([reviewing, applying, perform()]);
  expect(reviewed.request.expectedRevision).toBe(before.revision);
  expect(reviewed.review.expectedRevision).toBe(before.revision);
  expect(applied.command).toEqual({ ...reviewed.request, reviewHash: reviewed.review.reviewHash });
  for (const affected of reviewed.review.affected) {
    expect(affected.before).toEqual(before.occurrences.find((row) => row.id === affected.before.id));
    expect(affected.after).toEqual(applied.agenda.occurrences.find((row) => row.id === affected.after.id));
  }
  expect(applied.agenda.revision).toBe(before.revision + 1);
  expect(agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json())).toEqual(
    applied.agenda,
  );
  return applied.agenda;
}

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

/** The sidebar consumes canvas width rather than covering the calendar or portal. */
export async function openSessionSources(page: Page) {
  const canvas = page.locator(".pk-agenda-editor__canvas");
  const day = canvas.locator(".pk-content-agenda__day");
  const before = await day.evaluate((element) => ({
    viewport: element.clientWidth,
    canvas: element.parentElement!.clientWidth,
  }));
  const control = page.getByRole("button", { name: "Session sources", exact: true });
  if ((await control.getAttribute("aria-expanded")) !== "true") await control.click();
  const sidebar = page.getByRole("complementary", { name: "Session sources", exact: true });
  await expect(sidebar).toBeVisible();
  const bounds = await canvas.evaluate((element) => {
    const day = element.querySelector<HTMLElement>(".pk-content-agenda__day")!;
    const sidebar = element.querySelector<HTMLElement>(".pk-agenda-sources-panel")!;
    const main = day.getBoundingClientRect(),
      side = sidebar.getBoundingClientRect();
    return {
      viewport: day.clientWidth,
      canvas: element.clientWidth,
      mainRight: main.right,
      sideLeft: side.left,
      mainHeight: main.height,
      sideHeight: side.height,
    };
  });
  expect(bounds.canvas).toBe(before.canvas);
  expect(bounds.viewport).toBeLessThan(before.viewport);
  expect(bounds.sideLeft).toBeGreaterThanOrEqual(bounds.mainRight - 1);
  expect(Math.abs(bounds.sideHeight - bounds.mainHeight)).toBeLessThanOrEqual(1);
  await sidebar.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sidebar).toBeHidden();
  await expect.poll(() => day.evaluate((element) => element.clientWidth)).toBe(before.viewport);
  await expect(control).toBeFocused();
  await control.press("Enter");
  await expect(sidebar).toBeVisible();
  return sidebar;
}

/** Select a source and activate the exact free slot; both import phases remain canonical. */
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
  const card = page
    .getByRole("complementary", { name: "Session sources", exact: true })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await rowAction(page, card, "Schedule on agenda", mode);
  expect(await readPlacementAgenda(page, endpoint)).toEqual(before);
  const candidate = page
    .getByRole("button", {
      name: `Schedule selected proposal at ${formatTimeRangeInZone(startAt, undefined, before.timeZone)} in Workshop`,
      exact: true,
    })
    .first();
  await commitAcceptedPlacement(page, endpoint, title, startAt, endAt, before, () => activate(candidate, mode));
}

/** Observe the real dry-run fingerprint and guarded save, including untouched existing occurrences. */
export async function commitAcceptedPlacement(
  page: Page,
  endpoint: string,
  title: string,
  startAt: string,
  endAt: string,
  before: ReturnType<typeof agendaSnapshotSchema.parse>,
  trigger: () => Promise<unknown>,
) {
  const matching = (response: import("@playwright/test").Response, dryRun: boolean) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `${endpoint}/imports` &&
    agendaImportSchema.parse(response.request().postDataJSON()).dryRun === dryRun;
  const reviewing = page.waitForResponse((response) => matching(response, true), { timeout: 20_000 });
  const applying = page.waitForResponse((response) => matching(response, false), { timeout: 20_000 });
  await trigger();
  const review = await reviewing,
    applied = await applying;
  expect(review.status()).toBe(200);
  expect(applied.status()).toBe(200);
  const reviewed = agendaImportSchema.parse(review.request().postDataJSON());
  const preview = agendaImportResponseSchema.parse(await review.json());
  const command = agendaImportSchema.parse(applied.request().postDataJSON());
  const room = before.rooms.find((value) => value.name === "Workshop")!;
  expect(reviewed.expectedRevision).toBe(before.revision);
  expect(reviewed.proposalIds).toHaveLength(1);
  expect(reviewed.proposalPlacement).toMatchObject({ startAt, endAt, roomId: room.id });
  expect(command.dryRun).toBe(false);
  expect(command.proposalIds).toEqual(reviewed.proposalIds);
  expect(command.proposalPlacement).toEqual(reviewed.proposalPlacement);
  expect(command.expectedPlacementFingerprint).toBe(preview.placementFingerprint);
  const after = await readPlacementAgenda(page, endpoint);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.occurrences).toHaveLength(before.occurrences.length + 1);
  expect(after.occurrences.find((value) => value.title === title)).toMatchObject({ startAt, endAt, roomId: room.id });
  for (const prior of before.occurrences)
    expect(after.occurrences.find((value) => value.id === prior.id)).toEqual(prior);
}

/** Actual pointer move follows calendar rows; keyboard/touch use the equivalent focused dialog. */
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
  const endAt = new Date(
    Date.parse(startAt) + Date.parse(original.endAt!) - Date.parse(original.startAt!),
  ).toISOString();
  const sources = page.getByRole("complementary", { name: "Session sources", exact: true });
  if (await sources.isVisible()) await sources.getByRole("button", { name: "Close", exact: true }).click();
  const card = page.locator(`article[data-agenda-occurrence="${original.id}"]`).first();
  async function preparePointer() {
    await card.scrollIntoViewIfNeeded();
    const origin = await card.boundingBox();
    if (!origin) throw new Error("Scheduled card has no pointer geometry");
    const target = await page.locator(`tr[data-agenda-start="${startAt}"]`).evaluate(
      (row, roomIndex) => {
        const table = row.closest("table")!;
        const heading = table.querySelectorAll<HTMLElement>("thead th")[roomIndex + 1]!;
        const column = heading.getBoundingClientRect(),
          line = row.getBoundingClientRect();
        return { x: column.left + column.width / 2, y: line.top };
      },
      before.rooms.findIndex((value) => value.id === room.id),
    );
    await page.mouse.move(origin.x + origin.width / 2, origin.y + 12);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y + 12, { steps: 12 });
    await expect(page.locator("[data-agenda-pointer-source]")).toHaveCount(1);
    await expect(page.locator(".pk-agenda-editor__pointer-preview:not([hidden])")).toHaveCount(1);
  }
  if (mode === "pointer") {
    await preparePointer();
    await page.keyboard.press("Escape");
    await page.mouse.up();
  } else {
    await rowAction(page, card, "Move to day / location", mode);
    const dialog = page.getByRole("dialog", { name: `Move ${title}`, exact: true });
    await dialog.getByLabel(/^New day and start time/).fill(instantToDateTimeLocal(startAt, before.timeZone));
    await dialog.getByLabel("New location", { exact: true }).selectOption(room.id);
    await activate(dialog.getByRole("button", { name: "Cancel", exact: true }), mode);
  }
  expect(await readPlacementAgenda(page, endpoint)).toEqual(before);
  const reviewing = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `${endpoint}/schedule/reviews`,
    { timeout: 20_000 },
  );
  const applying = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `${endpoint}/schedule`,
    { timeout: 20_000 },
  );
  if (mode === "pointer") {
    await preparePointer();
    await page.mouse.up();
  } else {
    await rowAction(page, card, "Move to day / location", mode);
    const dialog = page.getByRole("dialog", { name: `Move ${title}`, exact: true });
    await dialog.getByLabel(/^New day and start time/).fill(instantToDateTimeLocal(startAt, before.timeZone));
    await dialog.getByLabel("New location", { exact: true }).selectOption(room.id);
    await activate(dialog.getByRole("button", { name: "Move session", exact: true }), mode);
    await expect(dialog).toBeHidden();
  }
  const reviewed = await reviewing,
    applied = await applying;
  expect(reviewed.status()).toBe(200);
  expect(applied.status()).toBe(200);
  const request = agendaScheduleProposalSchema.parse(reviewed.request().postDataJSON());
  const review = agendaScheduleReviewSchema.parse(await reviewed.json());
  const command = agendaScheduleApplySchema.parse(applied.request().postDataJSON());
  expect(request.expectedRevision).toBe(before.revision);
  expect(request.changes).toEqual([{ id: original.id, startAt, endAt, roomId: room.id, additionalRoomIds: [] }]);
  expect(review.affected[0]!.before).toEqual(original);
  expect(command.changes).toEqual(request.changes);
  expect(command.reviewHash).toBe(review.reviewHash);
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
