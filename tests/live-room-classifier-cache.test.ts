import { describe, expect, it, vi } from "vitest";
import {
  LIVE_CLASSIFIER_SETTINGS_TTL_MS,
  LiveRoomClassifiers,
} from "../functions/_lib/services/live-session/room-classifiers";

/** A database whose PKIC-wide chat check is off for the first read and on for the next ones. */
function database() {
  const reads = vi.fn();
  const statement = { bind: () => statement };
  return {
    reads,
    db: {
      prepare: () => statement,
      batch: async () => {
        reads();
        const enabled = reads.mock.calls.length > 1 ? 1 : 0;
        return [
          {
            results: [
              {
                kind: "chat_message",
                enabled,
                model: "clef-flash",
                context: "",
                questions_json: "[]",
                revision: 1,
                updated_at: "",
              },
            ],
          },
          { results: [] },
        ];
      },
    },
  };
}

describe("a room's cached check settings", () => {
  it("reads settings that were off again once they expire, so enabling a check takes effect", async () => {
    const store = {
      session: () => ({
        eventId: "event-1",
        session: {
          occurrenceId: "occurrence-1",
          startAt: "2030-01-01T10:00:00.000Z",
          endAt: "2030-01-01T11:00:00.000Z",
        },
      }),
    };
    const { db, reads } = database();
    const checks = new LiveRoomClassifiers({ AI: {}, DB: db } as never, store as never, {} as never);

    const start = 1_000_000;
    expect(checks.mayRun("chat_message", start)).toBe(true);
    await checks.run("chat_message", "hello", start);
    expect(checks.mayRun("chat_message", start + 1000)).toBe(false);

    const later = start + LIVE_CLASSIFIER_SETTINGS_TTL_MS + 1;
    expect(checks.mayRun("chat_message", later)).toBe(true);
    await checks.run("chat_message", "hello", later);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(checks.mayRun("chat_message", later + 1000)).toBe(true);
  });
});
