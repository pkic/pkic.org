import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { refreshDraftPins, type DraftSource } from "../../scripts/models/refresh-draft-pins.ts";
import { githubDraftSource } from "../../scripts/models/github-draft-source.ts";

const bytes = readFileSync("tests/fixtures/model-preview.yaml", "utf8");
const draft = {
  id: "assessment-methods",
  version: "1.1.0",
  status: "draft",
  root: "/wg/pqc/pqcmm/drafts/1.1.0/",
  branch: "agent/pqcmm-1.1.0-draft",
  commit: "a".repeat(40),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  aliases: ["/wg/pqc/pqcmm/drafts/old/"],
};
const registered = {
  models: [
    {
      root: "/wg/pqc/pqcmm/",
      sections: ["levels/"],
      repository: "pkic/pqcmm",
      contributionBranch: "main",
      sourcePath: "model/pqcmm-model.yaml",
      defaultVersion: "released",
      versions: [
        {
          id: "released",
          version: "1.0.1",
          status: "released",
          root: "/wg/pqc/pqcmm/versions/1.0.1/",
          commit: "c".repeat(40),
          sha256: "d".repeat(64),
          tag: "v1.0.1",
        },
        draft,
      ],
    },
  ],
};
const registry = stringify(registered);
const head = "b".repeat(40);
const remote = (): DraftSource => ({
  head: vi.fn(async () => head),
  validated: vi.fn(async () => true),
  model: vi.fn(async () => bytes),
});

describe("automatic model draft preview refresh", () => {
  it("updates draft provenance while preserving release entries, defaults, branch routing, and aliases", async () => {
    const result = await refreshDraftPins(registry, remote());
    const updated = parse(result.source);
    expect(result.changes).toBe(1);
    expect(updated.models[0].defaultVersion).toBe(registered.models[0].defaultVersion);
    expect(updated.models[0].versions.filter((v: { status: string }) => v.status === "released")).toEqual(
      registered.models[0].versions.filter((v: { status: string }) => v.status === "released"),
    );
    expect(updated.models[0].versions.find((v: { status: string }) => v.status === "draft")).toEqual({
      ...draft,
      commit: head,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });
  it("refreshes independent 1.1 and 2.0 drafts without selecting a different released default", async () => {
    const input = parse(registry);
    input.models[0].versions.push({
      ...draft,
      id: "next-objectives",
      version: "2.0.0",
      branch: "agent/next-draft",
      root: "/wg/pqc/pqcmm/drafts/2.0.0/",
      sourcePath: "model/next.yaml",
      aliases: [],
    });
    const source = remote();
    source.model = vi.fn(async (_repository, path) => {
      const model = parse(bytes);
      if (path === "model/next.yaml") model.model.version = "2.0.0";
      return stringify(model);
    });
    const result = await refreshDraftPins(stringify(input), source);
    expect(result.changes).toBe(2);
    const output = parse(result.source);
    expect(output.models[0].defaultVersion).toBe("released");
    expect(
      output.models[0].versions
        .filter((v: { status: string }) => v.status === "draft")
        .map((v: { version: string }) => v.version),
    ).toEqual(["1.1.0", "2.0.0"]);
  });
  it("does not publish a pending or failed source validation", async () => {
    const source = remote();
    source.validated = vi.fn(async () => false);
    expect(await refreshDraftPins(registry, source)).toEqual({ changes: 0, source: registry });
    expect(source.model).not.toHaveBeenCalled();
  });
  it("is byte-for-byte idempotent when the pinned revision is still current", async () => {
    const source = remote();
    source.head = vi.fn(async () => draft.commit);
    expect(await refreshDraftPins(registry, source)).toEqual({ changes: 0, source: registry });
    expect(source.validated).not.toHaveBeenCalled();
  });
  it("requires explicit review when the model version changes or the source is malformed", async () => {
    const source = remote();
    const changed = parse(bytes);
    changed.model.version = "2.0.0";
    source.model = vi.fn(async () => stringify(changed));
    await expect(refreshDraftPins(registry, source)).rejects.toThrow(/version mismatch/);
    source.model = vi.fn(async () => "model: invalid");
    await expect(refreshDraftPins(registry, source)).rejects.toThrow();
  });
  it("does not request released branches and fails closed on invalid revisions or network errors", async () => {
    const source = remote();
    source.head = vi.fn(async () => "main");
    await expect(refreshDraftPins(registry, source)).rejects.toThrow(/Invalid draft commit/);
    expect(source.head).toHaveBeenCalledTimes(1);
    source.head = vi.fn(async () => {
      throw new Error("unavailable");
    });
    await expect(refreshDraftPins(registry, source)).rejects.toThrow("unavailable");
  });
  it("checks the exact successful push validation and never sends the API token to raw content", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: head })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workflow_runs: [{ head_sha: head, conclusion: "success" }] })),
      )
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    try {
      const source = githubDraftSource("fixture-token");
      expect(await source.head("pkic/pqcmm", draft.branch)).toBe(head);
      expect(await source.validated("pkic/pqcmm", draft.branch, head)).toBe(true);
      expect(await source.model("pkic/pqcmm", "model/pqcmm-model.yaml", head)).toBe(bytes);
      expect(String(fetcher.mock.calls[1][0])).toContain(`head_sha=${head}`);
      expect(String(fetcher.mock.calls[1][0])).toContain("event=push");
      expect(fetcher.mock.calls[2][1]).not.toHaveProperty("headers.Authorization");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
