import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;

/** The attendee acts as their one identity: a chief architect at Digitorus, a member when `member`. */
async function giveAttendeeAffiliation(member = false) {
  const at = new Date().toISOString();
  const organizationId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, 'Digitorus', 'digitorus', ?, ?)",
  )
    .bind(organizationId, at, at)
    .run();
  if (member)
    await env.DB.prepare(
      "INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at) VALUES (?, 'organization', ?, 'active', ?, ?)",
    )
      .bind(crypto.randomUUID(), organizationId, at, at)
      .run();
  await env.DB.prepare(
    `INSERT INTO identities (id, user_id, organization_id, job_title, source, invited_at, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Chief Architect', 'staff', ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), f.users.attendee, organizationId, at, at, at, at)
    .run();
  await env.DB.prepare("INSERT INTO person_profile_slugs (slug, user_id, created_at) VALUES ('ada-attendee', ?, ?)")
    .bind(f.users.attendee, at)
    .run();
}

async function lookup(viewer: Client, handle: string) {
  viewer.send({ type: "author.lookup", handle });
  return (await viewer.next("author.details", (message) => message.handle === handle)).author;
}

const snapshotOf = (client: Client) => client.received[0] as Extract<LiveRoomServerMessage, { type: "room.snapshot" }>;

describe("live room authors", () => {
  beforeEach(() => f.setup());

  it("labels a message with the capacity it was written in and resolves its author's card by handle", async () => {
    await giveAttendeeAffiliation();
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    author.send({ type: "chat.send", text: "Hello from Digitorus" });
    const { message } = await reader.next("chat.message");
    expect(message.authorAffiliation).toEqual({ title: "Chief Architect", organization: { name: "Digitorus" } });
    expect(message.authorHandle).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(JSON.stringify(reader.received)).not.toContain(f.users.attendee);
    expect(await lookup(reader, message.authorHandle!)).toEqual({
      handle: message.authorHandle,
      name: "Ada Attendee",
      photoUrl: null,
      affiliation: { title: "Chief Architect", organization: { name: "Digitorus" } },
      roles: [],
      profilePath: "/people/ada-attendee/",
    });
  });

  it("marks authors with the public roles they hold when they write, highest first", async () => {
    await giveAttendeeAffiliation(true);
    const member = await f.connect({ person: "attendee" });
    const speaker = await f.connect({ person: "speaker" });
    const operator = await f.connect({ person: "operator" });
    member.send({ type: "chat.send", text: "From a member" });
    expect(
      (await operator.next("chat.message", (update) => update.message.text === "From a member")).message.authorRoles,
    ).toEqual(["member"]);
    speaker.send({ type: "chat.send", text: "From the stage" });
    expect(
      (await operator.next("chat.message", (update) => update.message.text === "From the stage")).message.authorRoles,
    ).toEqual(["speaker"]);
    operator.send({ type: "chat.send", text: "From the desk" });
    const desk = (await member.next("chat.message", (update) => update.message.text === "From the desk")).message;
    expect(desk.authorRoles).toEqual(["event_team"]);
    expect((await lookup(member, desk.authorHandle!))?.roles).toEqual(["event_team"]);
    member.send({ type: "question.ask", text: "Will the slides be shared?", anonymous: true });
    const asked = (await operator.next("question.changed")).question;
    // Moderators see who asked, but even they get no handle to look an anonymous author up by.
    expect(asked.authorHandle ?? null).toBeNull();
    operator.send({ type: "question.moderate", questionId: asked.id, status: "approved" });
    const anonymous = (await speaker.next("question.changed", (update) => update.question.id === asked.id)).question;
    expect(anonymous.authorRoles ?? []).toEqual([]);
    expect(anonymous.authorAffiliation ?? null).toBeNull();
  });

  it("refuses handles for people who wrote nothing visible, for anonymous questions and from other rooms", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const operator = await f.connect({ person: "operator" });
    // A well-formed handle nobody in this room holds, such as one copied from another room.
    expect(await lookup(reader, "A".repeat(32))).toBeNull();
    author.send({ type: "question.ask", text: "An anonymous question here?", anonymous: true });
    const asked = (await operator.next("question.changed")).question;
    expect(asked.authorHandle ?? null).toBeNull();
    operator.send({ type: "question.moderate", questionId: asked.id, status: "approved" });
    const shown = (await reader.next("question.changed")).question;
    expect(shown).toMatchObject({ authorName: null, authorPhotoUrl: null });
    expect(shown.authorHandle ?? null).toBeNull();
    // The author holds a handle (they wrote here) but nothing under their name: it resolves to nothing.
    author.send({ type: "chat.send", text: "Now under my name" });
    const { message } = await reader.next("chat.message");
    operator.send({ type: "chat.moderate", messageId: message.id, decision: "hide" });
    await reader.next("chat.removed");
    expect(await lookup(reader, message.authorHandle!)).toBeNull();
  });

  it("stops resolving deleted messages and redacted accounts, and limits lookups", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    author.send({ type: "chat.send", text: "Soon deleted" });
    const { message } = await reader.next("chat.message");
    const handle = message.authorHandle!;
    expect((await lookup(reader, handle))?.name).toBe("Ada Attendee");
    author.send({ type: "chat.delete", messageId: message.id });
    await reader.next("chat.removed");
    reader.send({ type: "author.lookup", handle });
    expect(
      (await reader.next("author.details", (update) => update.handle === handle && update.author === null)).author,
    ).toBeNull();
    author.send({ type: "chat.send", text: "Still here" });
    await reader.next("chat.message", (update) => update.message.text === "Still here");
    await env.DB.prepare("UPDATE users SET pii_redacted_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.users.attendee)
      .run();
    expect(await lookup(reader, handle)).toBeNull();
    for (let index = 0; index < 25; index++) reader.send({ type: "author.lookup", handle });
    expect((await reader.next("room.refused")).code).toBe("LIVE_CHAT_RATE_LIMITED");
    expect(snapshotOf(reader).chat.every((entry) => !JSON.stringify(entry).includes(f.users.attendee))).toBe(true);
  });
});
