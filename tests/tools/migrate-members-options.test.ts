import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { parseArgs, ENVS } from "../../scripts/migrate-members/cli.mjs";
import { runWranglerD1 } from "../../scripts/migrate-members/r2-adapter.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));

describe("member migration target arguments", () => {
  it.each(["--state", "--persist-to"])("forwards %s to the actual D1 command", (flag) => {
    const cli = parseArgs(["--", "--local", flag, "../rehearsal"], "/workspace/project");
    runWranglerD1("/workspace/project", ENVS.local, cli, "SELECT 1;");
    expect(execFileSync).toHaveBeenLastCalledWith(
      "pnpm",
      expect.arrayContaining(["--local", "--persist-to=/workspace/rehearsal"]),
      expect.objectContaining({ cwd: "/workspace/project" }),
    );
  });

  it("accepts equal-sign values and matching aliases", () => {
    expect(
      parseArgs(["--local", "--state=../rehearsal", "--persist-to", "/workspace/rehearsal"], "/workspace/project")
        .persistTo,
    ).toBe("/workspace/rehearsal");
  });

  it.each([
    ["--local", "--sttae", "/state"],
    ["--local", "--state"],
    ["--local", "--state", "--skip-logos"],
    ["--local", "--state="],
    ["--local", "--state", "/one", "--persist-to", "/two"],
    ["--preview", "--state", "/state"],
    ["--production", "--persist-to", "/state"],
    ["--local", "--production"],
    ["--local", "unexpected"],
  ])("rejects ambiguous or ignored target arguments: %j", (...args) => {
    expect(() => parseArgs(args, "/workspace")).toThrow();
  });
});
