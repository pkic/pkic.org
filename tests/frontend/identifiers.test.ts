import { describe, expect, it } from "vitest";
import { eventIdSchema } from "../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../assets/shared/schemas/identifiers";
import { roleIdSchema } from "../../assets/shared/schemas/access-control";
import { groupIdSchema, groupReferenceSchema } from "../../assets/shared/schemas/groups";

describe("database identifiers", () => {
  const runtimeUuid = "3f173fbe-d1f5-4c09-b2ed-9b7cb775cbe6";
  const migrationSeededId = "8cf09d26de5d49f3b065d60e177d5451";

  it("accepts runtime UUIDs and migration-seeded SQLite hex ids", () => {
    expect(databaseIdSchema.parse(runtimeUuid)).toBe(runtimeUuid);
    expect(databaseIdSchema.parse(migrationSeededId)).toBe(migrationSeededId);
    expect(groupIdSchema.parse(migrationSeededId)).toBe(migrationSeededId);
    expect(groupReferenceSchema.parse("ca")).toBe("ca");
  });

  it("keeps natural event and role ids in their own domain contracts", () => {
    expect(eventIdSchema.parse("pqc-2026")).toBe("pqc-2026");
    expect(roleIdSchema.parse("role-admin")).toBe("role-admin");
    expect(databaseIdSchema.safeParse("pqc-2026").success).toBe(false);
  });

  it("rejects arbitrary and malformed identifiers", () => {
    expect(databaseIdSchema.safeParse("").success).toBe(false);
    expect(databaseIdSchema.safeParse("role-admin").success).toBe(false);
    expect(groupIdSchema.safeParse("ca").success).toBe(false);
    expect(databaseIdSchema.safeParse("8cf09d26de5d49f3b065d60e177d545").success).toBe(false);
  });
});
