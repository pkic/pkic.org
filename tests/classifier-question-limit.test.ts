import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClassifierQuestion } from "../assets/shared/classifiers";
import {
  CLASSIFIER_MAX_EVENT_QUESTIONS,
  CLASSIFIER_MAX_KIND_QUESTIONS,
  CLASSIFIER_MAX_QUESTIONS,
  CLASSIFIER_MAX_SHARED_QUESTIONS,
} from "../assets/shared/classifiers";
import {
  readEffectiveClassifier,
  saveClassifierSettings,
  saveClassifierSharedSettings,
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

  it("fits the largest all-content, kind and event sets in one check, and a PKIC-wide save never reads an event", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    const profile = profileD1Flow(env.DB);
    await saveClassifierSharedSettings(profile.db, admin, {
      expectedRevision: 0,
      context: "",
      questions: questions(CLASSIFIER_MAX_SHARED_QUESTIONS, "shared"),
    });
    await saveWide(CLASSIFIER_MAX_KIND_QUESTIONS, admin, profile.db);
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

describe("turning off an all-content question", () => {
  beforeEach(resetDb);

  it("keeps only ids all content asks, and lets an event turn off a shared question the kind kept", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    const [conduct, spam] = questions(2, "shared");
    await saveClassifierSharedSettings(env.DB, admin, {
      expectedRevision: 0,
      context: "PKIC rules.",
      questions: [conduct!, spam!],
    });
    await saveClassifierSettings(env.DB, admin, "chat", {
      expectedRevision: 0,
      enabled: true,
      model: "clef",
      context: "Chat rules.",
      questions: [],
      disabledQuestionIds: [conduct!.id, "unknown_id"],
    });
    const wide = await readEffectiveClassifier(env.DB, null, "chat");
    expect(wide).toMatchObject({ context: "PKIC rules.\n\nChat rules.", questions: [spam] });

    await saveEventClassifierAdditions(env.DB, admin, eventId, "chat", {
      expectedRevision: 0,
      context: "",
      questions: [],
      disabledQuestionIds: [spam!.id],
    });
    expect((await readEffectiveClassifier(env.DB, eventId, "chat")).questions).toEqual([]);
  });
});

function saveWide(count: number, by: UserBackedAuthAdmin = actor, db: DatabaseLike = env.DB) {
  return saveClassifierSettings(db, by, "chat", {
    expectedRevision: 0,
    enabled: true,
    model: "clef-flash",
    context: "",
    questions: questions(count, "wide"),
    disabledQuestionIds: [],
  });
}
