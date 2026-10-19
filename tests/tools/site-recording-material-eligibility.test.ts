import { describe, expect, it } from "vitest";
import type { DatabaseLike, StatementLike } from "../../functions/_lib/types";
import {
  liveRecordingMaterialVersions,
  recordingEligibilityKey,
} from "../../functions/_lib/services/site-recording-material-eligibility";

describe("owned recording eligibility extraction", () => {
  it("bounds exact selected version evidence and retains event separation without exposing storage or provider fields", async () => {
    const queries: { sql: string; requested: { eventId: string; versionId: string }[] }[] = [];
    const db: DatabaseLike = {
      batch: async () => {
        throw new Error("Unexpected batch in read-only recording eligibility extraction");
      },
      prepare: (sql: string) => {
        let input: unknown;
        const statement: StatementLike = {
          bind: (...values) => {
            if (values.length !== 1) throw new Error("Expected one bounded version-selection JSON parameter");
            input = values[0];
            return statement;
          },
          run: async () => {
            throw new Error("Unexpected write in read-only recording eligibility extraction");
          },
          first: async () => {
            throw new Error("Unexpected scalar query in bounded recording eligibility extraction");
          },
          all: async <T>() => {
            queries.push({ sql, requested: JSON.parse(String(input)) });
            return {
              results: [
                {
                  event_id: "first",
                  id: "selected",
                  event_slug: "synthetic",
                  digest: "a".repeat(64),
                  file_size: 50,
                  mime_type: "video/mp4",
                },
              ] as T[],
            };
          },
        };
        return statement;
      },
    };
    const requested = Array.from({ length: 201 }, (_, index) => ({ eventId: "first", versionId: String(index) }));
    const result = await liveRecordingMaterialVersions(db, requested);
    expect(queries.map((query) => query.requested.length)).toEqual([100, 100, 1]);
    expect(result.has(recordingEligibilityKey("other", "selected"))).toBe(false);
    for (const { sql } of queries) {
      expect(sql).toContain("version.event_id=json_extract(requested.value,'$.eventId')");
      expect(sql).toContain("source.disabled_at IS NULL");
      expect(sql).toContain("version.deleted_at IS NULL");
      expect(sql).toContain("acquisition.completed_version_id=version.id");
      expect(sql).toContain("acquisition.expected_metadata_revision=version.source_metadata_revision");
      expect(sql).not.toContain("MAX(");
      expect(sql).not.toContain("provider_meeting_id");
    }
  });
});
