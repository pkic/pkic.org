import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  agendaOccurrenceCreateSchema,
  agendaRoomCreateSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { accessGrantCreateSchema, accessGrantCreateResponseSchema } from "../../assets/shared/schemas/access-control";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { signInToPortal } from "./helpers/portal-auth";
import { createMember } from "./helpers/member-provisioning";
import { createRegistrationEvent, registerStateAttendee } from "./helpers/participation-state-fixture";
import {
  connectLiveBrowser,
  expectLiveOperator,
  liveClose,
  liveMessages,
  measureLiveChatDelivery,
  sendLiveMessage,
} from "./helpers/live-session-browser";

test.use({ actionTimeout: 20_000 });

async function prepareDraftPoll(page: Page, label: string) {
  await sendLiveMessage(page, {
    type: "poll.save",
    pollId: null,
    draft: {
      field: {
        key: "private_poll",
        label,
        fieldType: "select",
        sortOrder: 0,
        required: true,
        options: [
          { value: "yes", label: "Yes", active: true },
          { value: "no", label: "No", active: true },
        ],
        validation: { uiWidget: "radios" },
      },
      showResults: true,
    },
  });
  await expect
    .poll(async () =>
      (await liveMessages(page)).some(
        (message) => message.type === "poll.changed" && message.poll.field.label === label,
      ),
    )
    .toBe(true);
  const message = (await liveMessages(page)).find(
    (message) => message.type === "poll.changed" && message.poll.field.label === label,
  );
  if (!message || message.type !== "poll.changed") throw new Error("Private draft poll missing");
  return message.poll;
}

test("two already-open live moderator clients stop receiving private questions, polls and queue updates after grant revocation", async ({
  page: staff,
  browser,
}, info) => {
  test.setTimeout(300_000);
  await signInAsE2eStaff(staff, e2eAdminEmail("portal-agenda-track-demand"));
  const now = new Date(),
    date = now.toISOString().slice(0, 10),
    dayStart = Date.parse(`${date}T00:00:00.000Z`),
    dayEnd = Date.parse(`${date}T23:59:00.000Z`);
  const fixture = await createRegistrationEvent(staff, "live-revocation", {
    date,
    startTime: "00:00",
    endTime: "23:59",
  });
  const api = `/api/v1/events/${fixture.slug}/agenda`;
  let agenda = agendaSnapshotSchema.parse(await (await staff.request.get(api)).json());
  const roomResponse = await staff.request.post(`${api}/rooms`, {
    data: agendaRoomCreateSchema.parse({
      expectedRevision: agenda.revision,
      name: "Synthetic live hall",
      capacity: 20,
    }),
  });
  expect(roomResponse.status(), await roomResponse.text()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await roomResponse.json());
  const room = agenda.rooms[0]!;
  const created = await staff.request.post(`${api}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: agenda.revision,
      title: "Synthetic live revocation acceptance",
      description: "Current-time private moderator delivery regression.",
      startAt: new Date(Math.max(now.getTime() - 60_000, dayStart)).toISOString(),
      endAt: new Date(Math.min(now.getTime() + 3_600_000, dayEnd)).toISOString(),
      roomId: room.id,
      admissionPolicy: "preference",
      accessPolicy: "open",
      speakerUserIds: [],
    }),
  });
  expect(created.status(), await created.text()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await created.json());
  const occurrence = agenda.occurrences[0]!;
  const published = await staff.request.post(`${api}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: agenda.revision }),
  });
  expect(published.status(), await published.text()).toBe(200);
  const moderator = await createMember(staff, { individual: true });
  const granting = await staff.request.post("/api/v1/permissions/grants", {
    data: accessGrantCreateSchema.parse({
      userId: moderator.userId,
      permission: "agenda:live_moderate",
      contextType: "event",
      contextId: fixture.eventId,
    }),
  });
  expect(granting.status(), await granting.text()).toBe(201);
  const grant = accessGrantCreateResponseSchema.parse(await granting.json()).grant;
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL: new URL(staff.url()).origin })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const path = `${api}/occurrences/${occurrence.id}/live`;
  const marker = crypto.randomUUID();
  try {
    await registerStateAttendee(pages[0]!, fixture, moderator.email, { staticRelease: false });
    await connectLiveBrowser(staff, path);
    await expectLiveOperator(staff);
    for (const page of pages) {
      await signInToPortal(page, moderator.email);
      await connectLiveBrowser(page, path);
      await expectLiveOperator(page);
    }
    await sendLiveMessage(staff, {
      type: "question.ask",
      operationId: crypto.randomUUID(),
      text: `Private baseline ${marker}`,
      anonymous: true,
    });
    await expect
      .poll(async () =>
        (await liveMessages(staff)).some(
          (message) => message.type === "question.changed" && message.question.text.includes("Private baseline"),
        ),
      )
      .toBe(true);
    const question = (await liveMessages(staff)).find(
      (message) => message.type === "question.changed" && message.question.text.includes("Private baseline"),
    );
    if (!question || question.type !== "question.changed") throw new Error("Baseline private question missing");
    expect(question.question.status).toBe("pending");
    const privatePoll = await prepareDraftPoll(staff, `Baseline private draft ${marker}`);
    await sendLiveMessage(staff, { type: "queue.add", view: "poll", itemId: privatePoll.id });
    for (const page of pages) {
      await expect
        .poll(async () =>
          (await liveMessages(page)).some(
            (message) => message.type === "queue.changed" && message.queue.poll.includes(privatePoll.id),
          ),
        )
        .toBe(true);
      const received = (await liveMessages(page)).find(
        (message) => message.type === "question.changed" && message.question.id === question.question.id,
      );
      expect(
        (await liveMessages(page)).some(
          (message) => message.type === "poll.changed" && message.poll.id === privatePoll.id,
        ),
      ).toBe(true);
      expect(received).toMatchObject({
        question: { anonymous: true, status: "pending", authorName: expect.any(String) },
      });
    }
    const latency = [];
    for (let sample = 0; sample < 5; sample++)
      latency.push(await measureLiveChatDelivery(staff, `Synthetic instant chat ${marker}-${sample}`));
    await writeFile(
      info.outputPath("live-chat-latency.json"),
      JSON.stringify({ targetMilliseconds: 100, samples: latency }, null, 2),
    );
    // Both passive clients stay on the same documents and send no command after this cutover.
    const baseline = await Promise.all(pages.map(liveMessages));
    const documents = await Promise.all(pages.map((page) => page.evaluate(() => performance.timeOrigin)));
    expect((await staff.request.delete(`/api/v1/permissions/grants/${grant.id}`)).status()).toBe(200);
    // Revocation is discovered by the bounded background refresh, without a command from either passive client.
    for (const page of pages) {
      await expect.poll(() => liveClose(page)).not.toBeNull();
      expect(await liveClose(page)).toMatchObject({ code: 4403, reason: "LIVE_SESSION_ACCESS_CHANGED" });
    }
    const futureQuestion = `After revocation ${marker}`;
    await sendLiveMessage(staff, {
      type: "question.ask",
      operationId: crypto.randomUUID(),
      text: futureQuestion,
      anonymous: true,
    });
    await expect
      .poll(async () =>
        (await liveMessages(staff)).some(
          (message) => message.type === "question.changed" && message.question.text === futureQuestion,
        ),
      )
      .toBe(true);

    await prepareDraftPoll(staff, `Future private draft ${marker}`);
    await sendLiveMessage(staff, { type: "queue.remove", view: "poll", itemId: privatePoll.id });
    await expect
      .poll(async () => (await liveMessages(staff)).filter((message) => message.type === "queue.changed").length)
      .toBe(2);
    for (const [index, page] of pages.entries()) {
      const after = await liveMessages(page);
      expect(after.slice(baseline[index]!.length)).toEqual([]);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(documents[index]);
      // Ordinary attendee access remains, but a fresh snapshot excludes operator-only content.
      expect((await page.request.get(`/api/v1/events/${fixture.slug}`)).status()).toBe(200);
      expect((await page.request.post(`${api}/rooms/${room.id}/live/overlays`)).status()).toBe(403);
      await connectLiveBrowser(page, path);
      await expect
        .poll(async () => (await liveMessages(page)).some((message) => message.type === "room.snapshot"))
        .toBe(true);
      const snapshot = (await liveMessages(page)).find((message) => message.type === "room.snapshot");
      expect(snapshot).toMatchObject({
        viewer: { role: "attendee" },
        questions: [],
        polls: [],
        queue: { question: [], poll: [], "lower-third": [] },
      });
    }
    await sendLiveMessage(staff, {
      type: "question.moderate",
      questionId: question.question.id,
      expectedRevision: question.question.revision,
      status: "approved",
    });
    for (const page of pages) {
      await expect
        .poll(async () =>
          (await liveMessages(page)).some(
            (message) => message.type === "question.changed" && message.question.id === question.question.id,
          ),
        )
        .toBe(true);
      const publicQuestion = (await liveMessages(page)).find(
        (message) => message.type === "question.changed" && message.question.id === question.question.id,
      );
      expect(publicQuestion).toMatchObject({ question: { status: "approved", anonymous: true, authorName: null } });
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(documents[pages.indexOf(page)]);
    }
    await writeFile(
      info.outputPath("live-revocation-receipt.json"),
      JSON.stringify(
        {
          eventId: fixture.eventId,
          occurrenceId: occurrence.id,
          clientCount: pages.length,
          grantedRole: "operator",
          revokedPermission: "agenda:live_moderate",
          reloadsAfterRevocation: 0,
          postRevocationPrivateMessages: 0,
          sameCookieReconnectPrivateMessages: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await staff.evaluate(() => globalThis.liveSessionBrowserProbe?.socket.close());
    await Promise.all(contexts.map((context) => context.close()));
  }
});
