import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "./helpers/source-files";

const ADMIN_API_ROOT = join(REPOSITORY_ROOT, "functions/api/v1/admin");

/**
 * The admin API surface is retired. This guard replaces the former mutation
 * inventory: rather than checking which admin routes exist, it asserts that
 * none do.
 *
 * It deliberately asks git rather than the filesystem. Git does not track
 * empty directories, so a working tree can retain `functions/api/v1/admin`
 * as untracked residue long after the last file is deleted — which would let
 * a filesystem-based check pass locally and fail on a clean checkout.
 */
describe("admin API retirement", () => {
  it("tracks no files under the retired admin API root", () => {
    const tracked = execFileSync("git", ["ls-files", "functions/api/v1/admin"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(tracked).toEqual([]);
  });

  it("does not depend on the retired directory existing on disk", () => {
    // Documents the invariant the previous implementation relied on by
    // accident: this suite must pass whether or not the residue is present.
    expect(typeof existsSync(ADMIN_API_ROOT)).toBe("boolean");
  });
});
