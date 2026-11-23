import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClassifierQuestion } from "../assets/shared/classifiers";
import {
  CLASSIFIER_MAX_EVENT_QUESTIONS,
  CLASSIFIER_MAX_QUESTIONS,
  CLASSIFIER_MAX_WIDE_QUESTIONS,
} from "../assets/shared/classifiers";
import {
  readEffectiveClassifier,
  saveClassifierSettings,
  saveEventClassifierAdditions,
} from "../functions/_lib/services/classifiers/settings";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import type { DatabaseLike } from "../functions/_lib/types";
import { seedEventAndAdmin } from "./helpers/context";
import { profileD1Flow } from "./helpers/d1-flow-profile";
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

describe("saving questions that must fit together", () => {
  beforeEach(resetDb);

  it("fits the largest PKIC-wide and event sets in one check, and a PKIC-wide save never reads an event", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    const profile = profileD1Flow(env.DB);
    await saveWide(CLASSIFIER_MAX_WIDE_QUESTIONS, admin, profile.db);
    expect(profile.summary().queries.some((query) => query.sql.includes("event_classifier_additions"))).toBe(false);
    await saveEventClassifierAdditions(env.DB, admin, eventId, "chat", {
      expectedRevision: 0,
      context: "",
      questions: questions(CLASSIFIER_MAX_EVENT_QUESTIONS, "event"),
      disabledQuestionIds: [],
    });
    const check = await readEffectiveClassifier(env.DB, eventId, "chat");
    expect(check.questions).toHaveLength(CLASSIFIER_MAX_QUESTIONS);
  });
});

function saveWide(count: number, by: UserBackedAuthAdmin = actor, db: DatabaseLike = env.DB) {
  return saveClassifierSettings(db, by, "chat", {
    expectedRevision: 0,
    enabled: true,
    model: "clef-flash",
    context: "",
    questions: questions(count, "wide"),
  });
}
