import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { liveSpeakerCandidatesResponseSchema } from "../assets/shared/schemas/live-session-credit";
import { callApi } from "./helpers/app";
import { insertOrganization } from "./helpers/membership";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();

/** Gives a person a profile photo, as an upload would. */
async function giveHeadshot(userId: string) {
  await env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?")
    .bind(`headshots/${userId}/portrait.jpg`, userId)
    .run();
  return `/api/v1/users/${userId}/headshots/portrait.jpg`;
}

describe("people operators add to a session's lower thirds", () => {
  beforeEach(() => f.setup());

  it("shares an added person with every operator, never attendees, and puts them on air like a credit", async () => {
    const operator = await f.connect({ person: "operator" });
    const remote = await f.connect({ person: "secondOperator" });
    const attendee = await f.connect({ person: "attendee" });
    operator.send({ type: "credit.add", person: { userId: null, identityId: null, name: "Grace Guest" } });
    const added = await remote.next("credits.added.changed", (m) => m.addedCredits.length === 1);
    const guest = added.addedCredits[0]!;
    expect(guest).toMatchObject({ name: "Grace Guest", identity: null, photoUrl: null, roleLabel: null });
    expect(guest.key).toMatch(/^added:/u);
    expect(attendee.received.some((m) => m.type === "credits.added.changed")).toBe(false);
    const late = await f.connect({ person: "secondAttendee" });
    expect((await late.next("room.snapshot")).addedCredits).toEqual([]);
    const rejoined = await f.connect({ person: "secondOperator" });
    expect((await rejoined.next("room.snapshot")).addedCredits.map((credit) => credit.name)).toEqual(["Grace Guest"]);

    operator.send({ type: "stage.lowerThird", creditKey: guest.key });
    expect((await attendee.next("stage.changed")).stage.lowerThird?.name).toBe("Grace Guest");
    operator.send({ type: "credit.remove", creditKey: guest.key });
    expect((await operator.next("room.refused")).code).toBe("LIVE_CREDIT_ON_AIR");

    operator.send({ type: "stage.lowerThird", creditKey: null });
    await operator.next("stage.changed", (m) => m.stage.lowerThird === null);
    operator.send({ type: "preview.set", composition: { creditKey: guest.key } });
    await operator.next("preview.changed", (m) => m.composition.lowerThird?.key === guest.key);
    operator.send({ type: "credit.remove", creditKey: guest.key });
    await remote.next("credits.added.changed", (m) => m.addedCredits.length === 0);
    await remote.next("preview.changed", (m) => m.composition.lowerThird === null);
    operator.send({ type: "preview.set", composition: { creditKey: guest.key } });
    await operator.next("room.refused", (m) => m.code === "LIVE_CREDIT_NOT_FOUND");
  });

  it("names and pictures a person picked from the event's people, as the identity picked", async () => {
    const photo = await giveHeadshot(f.users.secondAttendee);
    const organization = await insertOrganization(env.DB, "Lattice Labs");
    const identity = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, job_title, source, is_default, invited_at, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Research Lead', 'staff', 0, ?, ?, ?, ?)`,
    )
      .bind(identity, f.users.secondAttendee, organization, ...Array(4).fill(new Date().toISOString()))
      .run();
    const operator = await f.connect({ person: "operator" });
    operator.send({
      type: "credit.add",
      person: { userId: f.users.secondAttendee, identityId: identity, name: "Typed name" },
    });
    const added = await operator.next("credits.added.changed", (m) => m.addedCredits.length === 1);
    expect(added.addedCredits[0]).toMatchObject({
      name: "Bea Attendee",
      photoUrl: photo,
      identity: { title: "Research Lead", organization: "Lattice Labs" },
    });
    // Another person's identity is refused, so nobody appears in a capacity that is not theirs.
    operator.send({
      type: "credit.add",
      person: { userId: f.users.attendee, identityId: identity, name: "Typed name" },
    });
    expect((await operator.next("room.refused")).code).toBe("LIVE_PERSON_NOT_FOUND");
    // The same person in the same capacity is listed once, and a credited speaker already has a row.
    operator.send({
      type: "credit.add",
      person: { userId: f.users.secondAttendee, identityId: identity, name: "Typed name" },
    });
    expect((await operator.next("room.refused", (m) => m.code !== "LIVE_PERSON_NOT_FOUND")).code).toBe(
      "LIVE_PERSON_ALREADY_ADDED",
    );
    operator.send({ type: "credit.add", person: { userId: f.users.speaker, identityId: null, name: "Typed name" } });
    await operator.next("room.refused", (m) => m.code === "LIVE_PERSON_ALREADY_ADDED");
    // The same person as themselves, a different capacity, is a row of its own.
    operator.send({
      type: "credit.add",
      person: { userId: f.users.secondAttendee, identityId: null, name: "Typed name" },
    });
    await operator.next("credits.added.changed", (m) => m.addedCredits.length === 2);
  });
});

describe("an asker's photo", () => {
  beforeEach(() => f.setup());

  it("shows with a question asked by name, never with an anonymous one, on the desk and on air", async () => {
    const photo = await giveHeadshot(f.users.attendee);
    const organization = await insertOrganization(env.DB, "Example Trust");
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, is_default, invited_at, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'staff', 1, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), f.users.attendee, organization, ...Array(4).fill(new Date().toISOString()))
      .run();
    const author = await f.connect({ person: "attendee" });
    const operator = await f.connect({ person: "operator" });
    author.send({ type: "question.ask", text: "Is hybrid key exchange enough?", anonymous: false });
    const named = (await operator.next("question.changed")).question;
    expect(named).toMatchObject({
      authorPhotoUrl: photo,
      authorAffiliation: { organization: expect.objectContaining({ name: "Example Trust" }) },
    });
    author.send({ type: "question.ask", text: "Who pays for the migration?", anonymous: true });
    const hidden = (await operator.next("question.changed", (m) => m.question.anonymous)).question;
    expect(hidden).toMatchObject({ authorPhotoUrl: null });

    for (const question of [named, hidden]) {
      operator.send({ type: "question.moderate", questionId: question.id, status: "approved" });
      await operator.next("question.changed", (m) => m.question.id === question.id && m.question.status === "approved");
    }
    operator.send({ type: "preview.set", composition: { questionId: named.id } });
    expect((await operator.next("preview.changed")).composition.question).toMatchObject({
      authorName: "Ada Attendee",
      authorPhotoUrl: photo,
      authorAffiliation: { organization: expect.objectContaining({ name: "Example Trust" }) },
    });
    operator.send({ type: "preview.set", composition: { questionId: hidden.id } });
    expect(
      (await operator.next("preview.changed", (m) => m.composition.question?.id === hidden.id)).composition.question,
    ).toMatchObject({ authorName: null, authorPhotoUrl: null, authorAffiliation: null });
  });
});

describe("searching people for a lower third", () => {
  beforeEach(() => f.setup());

  it("finds each identity of the event's people for a live operator without agenda editing, and nobody else", async () => {
    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,'agenda:live_moderate','event',?,?)",
    )
      .bind(crypto.randomUUID(), f.users.secondAttendee, f.eventId, new Date().toISOString())
      .run();
    const at = new Date().toISOString();
    for (const [name, title] of [
      ["Northwind Trust", "Vice Chair"],
      ["Example Agency", "Policy Authority"],
    ] as const) {
      const organization = await insertOrganization(env.DB, name);
      await env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, job_title, source, is_default, invited_at, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'staff', 0, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), f.users.speaker, organization, title, at, at, at, at)
        .run();
    }
    const search = (person: "secondAttendee" | "attendee" | "outsider", q = "sam") =>
      callApi(env, `/api/v1/events/${f.eventSlug}/agenda/people/identities?q=${q}&limit=8&offset=0&sort=name`, {
        headers: { authorization: `Bearer ${f.tokens[person]}`, origin: "https://app.test" },
      });
    const allowed = await search("secondAttendee");
    expect(allowed.status).toBe(200);
    // The credited speaker speaks for two organizations, so they are found once for each.
    expect(
      liveSpeakerCandidatesResponseSchema
        .parse(await allowed.json())
        .identities.map((candidate) => [candidate.name, candidate.title, candidate.organization]),
    ).toEqual([
      ["Sam Speaker", "Policy Authority", "Example Agency"],
      ["Sam Speaker", "Vice Chair", "Northwind Trust"],
    ]);
    const byOrganization = await search("secondAttendee", "northwind");
    expect(liveSpeakerCandidatesResponseSchema.parse(await byOrganization.json()).identities).toHaveLength(1);
    // A registered attendee of the session, and anyone else signed in, is refused.
    expect((await search("attendee")).status).toBe(403);
    expect((await search("outsider")).status).toBe(403);
  });
});

describe("a speaker's capacity on the lower third", () => {
  beforeEach(() => f.setup());

  it("reads the title and organization from the identity, as the identity has them now", async () => {
    const organization = await insertOrganization(env.DB, "Northwind Trust");
    const identity = crypto.randomUUID();
    const at = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, job_title, source, is_default, invited_at, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Vice Chair', 'staff', 1, ?, ?, ?, ?)`,
    )
      .bind(identity, f.users.speaker, organization, at, at, at, at)
      .run();
    const operator = await f.connect({ person: "operator" });
    expect((await operator.next("room.snapshot")).session.credits[0]!.identity).toEqual({
      title: "Vice Chair",
      organization: "Northwind Trust",
    });
    // A lower third already on air follows the identity when the room reads the session again.
    operator.send({ type: "stage.lowerThird", creditKey: `user:${f.users.speaker}` });
    await operator.next("stage.changed", (m) => m.stage.lowerThird?.identity?.title === "Vice Chair");
    await env.DB.prepare("UPDATE identities SET job_title='Chair' WHERE id=?").bind(identity).run();
    const second = await f.connect({ person: "secondOperator" });
    expect((await second.next("room.snapshot")).stage.lowerThird?.identity?.title).toBe("Chair");
    await operator.next("stage.changed", (m) => m.stage.lowerThird?.identity?.title === "Chair");
  });
});

describe("hosts and the moderator", () => {
  beforeEach(() => f.setup());

  it("offers the moderator and the hosts the agenda shows on duty, each with their role", async () => {
    const occurrence = await env.DB.prepare(
      "SELECT json_extract(payload_json,'$.startAt') AS startAt, json_extract(payload_json,'$.endAt') AS endAt FROM event_agenda_published_occurrences WHERE occurrence_id=?",
    )
      .bind(f.occurrenceId)
      .first<{ startAt: string; endAt: string }>();
    const shift = {
      id: "room-hosts",
      name: "Main hall",
      startAt: occurrence!.startAt,
      endAt: occurrence!.endAt,
      locationId: f.roomId,
      duties: [
        { role: "Host", displayName: "Hana Host" },
        // Someone already credited keeps their speaker credit.
        { role: "Host", displayName: "Sam Speaker" },
      ],
    };
    await env.DB.prepare(
      "UPDATE event_agenda_publications SET snapshot_json=json_set(snapshot_json,'$.displayRoles',json(?)) WHERE event_id=?",
    )
      .bind(JSON.stringify([shift]), f.eventId)
      .run();
    await env.DB.prepare(
      "UPDATE event_agenda_published_occurrences SET payload_json=json_set(payload_json,'$.speakers[0].role','moderator') WHERE occurrence_id=?",
    )
      .bind(f.occurrenceId)
      .run();
    const operator = await f.connect({ person: "operator" });
    const credits = (await operator.next("room.snapshot")).session.credits;
    expect(credits.map((credit) => [credit.name, credit.roleLabel])).toEqual([
      ["Sam Speaker", "Moderator"],
      ["Hana Host", "Host"],
    ]);
    operator.send({ type: "stage.lowerThird", creditKey: credits[1]!.key });
    expect((await operator.next("stage.changed")).stage.lowerThird).toMatchObject({
      name: "Hana Host",
      roleLabel: "Host",
    });
  });
});
