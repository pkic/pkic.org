import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContentCheckQuestion } from "../assets/shared/content-checks";
import { CONTENT_CHECK_MAX_QUESTIONS } from "../assets/shared/content-checks";
import {
  saveContentCheckSettings,
  saveEventContentCheckAdditions,
} from "../functions/_lib/services/content-checks/settings";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { proposalIdentityFixture } from "./helpers/proposal-identity";
import { resetDb } from "./helpers/reset-db";

const actor = { id: "nobody" } as unknown as UserBackedAuthAdmin;

function questions(count: number, prefix: string): ContentCheckQuestion[] {
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
      `INSERT INTO content_check_settings (kind, enabled, model, context, questions_json, revision, updated_at)
       VALUES ('chat_message', 1, 'clef-flash', '', ?, 1, ?)`,
    )
      .bind(JSON.stringify(questions(CONTENT_CHECK_MAX_QUESTIONS, "wide")), new Date().toISOString())
      .run();
    const error = await refusal(
      saveEventContentCheckAdditions(env.DB, actor, eventId, "chat_message", {
        expectedRevision: 0,
        context: "",
        questions: questions(1, "event"),
        disabledQuestionIds: [],
      }),
    );
    expect(error?.status).toBe(400);
    expect(error?.details.fieldErrors.questions?.[0]).toContain(String(CONTENT_CHECK_MAX_QUESTIONS + 1));
  });

  it("refuses PKIC-wide questions that would leave an event over the limit", async () => {
    const { eventId } = await proposalIdentityFixture();
    await env.DB.prepare(
      `INSERT INTO event_content_check_additions (event_id, kind, context, questions_json, disabled_question_ids_json, revision, updated_at)
       VALUES (?, 'chat_message', '', ?, '[]', 1, ?)`,
    )
      .bind(eventId, JSON.stringify(questions(CONTENT_CHECK_MAX_QUESTIONS, "event")), new Date().toISOString())
      .run();
    const error = await refusal(saveWide(1));
    expect(error?.status).toBe(400);
    expect(error?.details.fieldErrors.questions?.[0]).toContain("1 event");
  });
});

function saveWide(count: number) {
  return saveContentCheckSettings(env.DB, actor, "chat_message", {
    expectedRevision: 0,
    enabled: true,
    model: "clef-flash",
    context: "",
    questions: questions(count, "wide"),
  });
}
