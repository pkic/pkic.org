import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClassifierQuestion } from "../assets/shared/classifiers";
import { CLASSIFIER_MAX_QUESTIONS } from "../assets/shared/classifiers";
import { saveClassifierSettings, saveEventClassifierAdditions } from "../functions/_lib/services/classifiers/settings";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import type { DatabaseLike } from "../functions/_lib/types";
import { seedEventAndAdmin } from "./helpers/context";
import { proposalIdentityFixture } from "./helpers/proposal-identity";
import { resetDb } from "./helpers/reset-db";

const actor = { id: "nobody" } as unknown as UserBackedAuthAdmin;

function questions(count: number, prefix: string): ClassifierQuestion[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}_${String(index).padStart(2, "0")}`,
    kind: "flag",
    question: "Is this spam?",
    adviseAtPercent: 50,
    blockAtPercent: 90,
    message: "This looks like spam.",
  }));
}

async function refusal(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => null,
    (caught: unknown) => caught,
  )) as { status: number; details: { fieldErrors: Record<string, string[]> } } | null;
  return error;
}

describe("saving questions that must fit together", () => {
  beforeEach(resetDb);

  it("refuses event additions that would push the check past the limit, naming the field", async () => {
    const { eventId } = await proposalIdentityFixture();
    await env.DB.prepare(
      `INSERT INTO classifier_settings (kind, enabled, model, context, questions_json, revision, updated_at)
       VALUES ('chat_message', 1, 'clef-flash', '', ?, 1, ?)`,
    )
      .bind(JSON.stringify(questions(CLASSIFIER_MAX_QUESTIONS, "wide")), new Date().toISOString())
      .run();
    const error = await refusal(
      saveEventClassifierAdditions(env.DB, actor, eventId, "chat_message", {
        expectedRevision: 0,
        context: "",
        questions: questions(1, "event"),
        disabledQuestionIds: [],
      }),
    );
    expect(error?.status).toBe(400);
    expect(error?.details.fieldErrors.questions?.[0]).toContain(String(CLASSIFIER_MAX_QUESTIONS + 1));
  });

  it("refuses PKIC-wide questions that would leave an event over the limit", async () => {
    const { eventId } = await proposalIdentityFixture();
    await env.DB.prepare(
      `INSERT INTO event_classifier_additions (event_id, kind, context, questions_json, disabled_question_ids_json, revision, updated_at)
       VALUES (?, 'chat_message', '', ?, '[]', 1, ?)`,
    )
      .bind(eventId, JSON.stringify(questions(CLASSIFIER_MAX_QUESTIONS, "event")), new Date().toISOString())
      .run();
    const error = await refusal(saveWide(1));
    expect(error?.status).toBe(400);
    expect(error?.details.fieldErrors.questions?.[0]).toContain("1 event");
  });

  it("refuses either save when the other scope changed after the limit was checked", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    const saveEvent = (db: DatabaseLike) =>
      saveEventClassifierAdditions(db, admin, eventId, "chat_message", {
        expectedRevision: 0,
        context: "",
        questions: questions(1, "event"),
        disabledQuestionIds: [],
      });
    // The PKIC-wide save lands between the event save's read and its write.
    const eventError = await refusal(
      saveEvent(afterRead(env.DB, "FROM classifier_settings", () => saveWide(CLASSIFIER_MAX_QUESTIONS, admin))),
    );
    expect(eventError?.status).toBe(409);

    // And the other way round: an event save lands while a PKIC-wide save checks the limit.
    await env.DB.prepare("DELETE FROM classifier_settings").run();
    const wideError = await refusal(
      saveWide(
        CLASSIFIER_MAX_QUESTIONS,
        admin,
        afterRead(env.DB, "FROM event_classifier_additions", () => saveEvent(env.DB)),
      ),
    );
    expect(wideError?.status).toBe(409);
  });
});

/** The database as a save sees it, with another write landing right after the first read of the given table. */
function afterRead(db: DatabaseLike, table: string, write: () => Promise<unknown>): DatabaseLike {
  let pending = true;
  const interleave = async <T>(read: () => Promise<T>) => {
    const result = await read();
    if (pending) {
      pending = false;
      await write();
    }
    return result;
  };
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver);
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes(table) || !sql.trimStart().startsWith("SELECT")) return statement;
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
            return {
              first: <T>() => interleave(() => bound.first<T>()),
              all: <T>() => interleave(() => bound.all<T>()),
            };
          },
        };
      };
    },
  }) as DatabaseLike;
}

function saveWide(count: number, by: UserBackedAuthAdmin = actor, db: DatabaseLike = env.DB) {
  return saveClassifierSettings(db, by, "chat_message", {
    expectedRevision: 0,
    enabled: true,
    model: "clef-flash",
    context: "",
    questions: questions(count, "wide"),
  });
}
