import { describe, expect, it } from "vitest";
import { liveChatActions } from "../assets/shared/live-chat-policy";
import {
  CLASSIFIER_MAX_QUESTIONS,
  classifierQuestionLimitRefusal,
  decideClassifier,
  effectiveClassifier,
  mergedClassifierQuestions,
  type ClassifierQuestion,
  type ClassifierSettings,
} from "../assets/shared/classifiers";
import { classifierFlagSchema, classifierSettingsInputSchema } from "../assets/shared/schemas/classifiers";

const spam: ClassifierQuestion = {
  id: "spam",
  kind: "flag",
  question: "Is this spam?",
  adviseAtPercent: 50,
  blockAtPercent: 90,
  message: "This looks like spam.",
};
const offTopic: ClassifierQuestion = {
  id: "off_topic",
  kind: "flag",
  question: "Is this off topic?",
  adviseAtPercent: 60,
  blockAtPercent: null,
  message: "This seems off topic.",
};
const depth: ClassifierQuestion = {
  id: "depth",
  kind: "score",
  label: "Depth",
  question: "How deep is it?",
  levels: ["Shallow", "Some", "Deep"],
  weight: 1,
};
const clarity: ClassifierQuestion = { ...depth, id: "clarity", label: "Clarity", weight: 3 };

describe("deciding a check", () => {
  it("passes below the advise level, advises from it, blocks only where a block level is set, most certain first", () => {
    expect(decideClassifier([spam, offTopic], { spam: { kind: "flag", probability: 0.2 } }).outcome).toBe("passed");

    const advised = decideClassifier([spam, offTopic], {
      spam: { kind: "flag", probability: 0.5 },
      off_topic: { kind: "flag", probability: 0.99 },
    });
    expect(advised.outcome).toBe("advised");
    expect(advised.flags).toEqual([
      { id: "off_topic", probabilityPercent: 99, blocking: false, message: "This seems off topic." },
      { id: "spam", probabilityPercent: 50, blocking: false, message: "This looks like spam." },
    ]);

    const blocked = decideClassifier([spam], { spam: { kind: "flag", probability: 0.9 } });
    expect(blocked).toMatchObject({ outcome: "blocked", flags: [{ id: "spam", blocking: true }] });
  });

  it("reads a score as its likeliest level and weights the total", () => {
    const verdict = decideClassifier([depth, clarity], {
      depth: { kind: "score", probabilities: [1, 0, 0] },
      clarity: { kind: "score", probabilities: [0, 0, 1] },
    });
    expect(verdict.outcome).toBe("passed");
    expect(verdict.scores).toEqual([
      { id: "depth", label: "Depth", percent: 0, level: "Shallow" },
      { id: "clarity", label: "Clarity", percent: 100, level: "Deep" },
    ]);
    expect(verdict.scorePercent).toBe(75);
  });

  it("ignores missing and mismatched answers", () => {
    const verdict = decideClassifier([spam, depth], {
      spam: { kind: "score", probabilities: [1, 0] },
      depth: { kind: "score", probabilities: [0, 0, 0] },
    });
    expect(verdict).toEqual({ outcome: "passed", flags: [], scores: [], scorePercent: null });
  });
});

describe("an event's check", () => {
  const settings: ClassifierSettings = {
    enabled: true,
    model: "clef-flash",
    context: "PKIC-wide rules.",
    questions: [spam, offTopic],
  };

  it("is the PKIC-wide check when the event adds nothing", () => {
    expect(effectiveClassifier(settings, null)).toEqual(settings);
  });

  it("reads the PKIC-wide context, then the event description, then what the event adds, and bounds the description", () => {
    const additions = { context: "Added.", questions: [], disabledQuestionIds: [] };
    expect(effectiveClassifier(settings, additions, "The event is held in a harbor.").context).toBe(
      "PKIC-wide rules.\n\nThe event is held in a harbor.\n\nAdded.",
    );
    const bounded = effectiveClassifier(settings, null, "word ".repeat(1000)).context;
    expect(bounded.length).toBeLessThan("PKIC-wide rules.\n\n".length + 1600);
    expect(bounded.endsWith("…")).toBe(true);
  });

  it("adds context, replaces and turns off questions, and appends its own", () => {
    const stricter = { ...offTopic, blockAtPercent: 95, question: "Is this off this event's topics?" };
    const effective = effectiveClassifier(settings, {
      context: "This event is about post-quantum migration.",
      questions: [stricter, depth],
      disabledQuestionIds: ["spam"],
    });
    expect(effective.context).toBe("PKIC-wide rules.\n\nThis event is about post-quantum migration.");
    expect(effective.questions).toEqual([stricter, depth]);
    expect(effective).toMatchObject({ enabled: true, model: "clef-flash" });
  });
});

describe("check settings contract", () => {
  it("refuses a block level below the advise level and duplicate ids", () => {
    expect(classifierFlagSchema.safeParse({ ...spam, blockAtPercent: 40 }).success).toBe(false);
    const duplicate = classifierSettingsInputSchema.safeParse({
      expectedRevision: 0,
      enabled: true,
      model: "clef",
      context: "",
      questions: [spam, spam],
    });
    expect(duplicate.success).toBe(false);
  });
});

describe("an event's questions beside the PKIC-wide ones", () => {
  const many = (count: number, prefix: string): ClassifierQuestion[] =>
    Array.from({ length: count }, (_, index) => ({ ...spam, id: `${prefix}_${String(index).padStart(2, "0")}` }));

  it("keeps every saved question and refuses a set above the limit instead of dropping the extras", () => {
    const wide = many(CLASSIFIER_MAX_QUESTIONS, "wide");
    const extra = { context: "", questions: [{ ...spam, id: "event_only" }], disabledQuestionIds: [] };
    expect(classifierQuestionLimitRefusal(wide, extra)).toContain(`${CLASSIFIER_MAX_QUESTIONS + 1}`);
    expect(mergedClassifierQuestions(wide, extra)).toHaveLength(CLASSIFIER_MAX_QUESTIONS + 1);
    expect(effectiveClassifier({ ...settings(wide) }, extra).questions.map((question) => question.id)).toContain(
      "event_only",
    );
  });

  it("counts a replacement once and a switched-off question not at all", () => {
    const wide = many(CLASSIFIER_MAX_QUESTIONS, "wide");
    expect(
      classifierQuestionLimitRefusal(wide, {
        context: "",
        questions: [
          { ...spam, id: "wide_00" },
          { ...spam, id: "event_only" },
        ],
        disabledQuestionIds: ["wide_01"],
      }),
    ).toBeNull();
  });
});

describe("keeping a message the automatic check flagged", () => {
  it("offers a moderator keep for a flagged message nobody reported, and no one else", () => {
    const message = {
      channel: "attendee" as const,
      mine: false,
      hidden: false,
      held: false,
      reported: false,
      reportedByMe: false,
      converted: false,
      done: false,
      authorStaff: false,
      authorRestriction: null,
      sentAt: new Date().toISOString(),
      editLocked: false,
    };
    expect(liveChatActions("moderator", false, message).has("keep")).toBe(false);
    expect(liveChatActions("moderator", false, { ...message, flaggedByCheck: true }).has("keep")).toBe(true);
    expect(liveChatActions("participant", false, { ...message, flaggedByCheck: true }).has("keep")).toBe(false);
  });
});

function settings(questions: ClassifierQuestion[]): ClassifierSettings {
  return { enabled: true, model: "clef-flash", context: "", questions };
}
