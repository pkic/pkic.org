import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: spawn }));
import { apply } from "../../scripts/apply-d1-migrations.mjs";

const migration = "0043_shared_organization_domains.sql";

describe("shared-domain atomic migration import", () => {
  it.each(["preview", "production"])("imports 0043 and its ledger entry together for %s", (target) => {
    const previous = readdirSync(resolve(import.meta.dirname, "../../migrations")).filter(
      (name) => name.endsWith(".sql") && name !== migration,
    );
    let imported = false;
    spawn.mockImplementation((_command: string, args: string[]) => {
      const query = args[args.indexOf("--command") + 1];
      const fileIndex = args.indexOf("--file");
      if (fileIndex >= 0) {
        expect(args).toContain("execute");
        expect(args).toContain("--remote");
        expect(args.includes("--preview")).toBe(target === "preview");
        const sql = readFileSync(args[fileIndex + 1], "utf8");
        expect(sql).toContain("DROP TABLE organization_domain_claims;");
        expect(sql).toContain("CREATE TRIGGER validate_organization_domain_claim_owner_update");
        expect(sql.trimEnd().endsWith(`INSERT INTO d1_migrations (name) VALUES ('${migration}');`)).toBe(true);
        imported = true;
      }
      const results = query?.startsWith("SELECT name FROM d1_migrations WHERE")
        ? imported
          ? [{ name: migration }]
          : []
        : previous.map((name) => ({ name }));
      if (args.includes("apply")) expect(imported).toBe(true);
      return { status: 0, stdout: JSON.stringify([{ success: true, results }]), stderr: "" };
    });
    apply(target);
    expect(imported).toBe(true);
    expect(spawn.mock.calls.filter(([, args]) => args.includes("--file"))).toHaveLength(1);
    spawn.mockReset();
  });
});
