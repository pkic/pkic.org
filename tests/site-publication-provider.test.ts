import { describe, it, expect, vi } from "vitest";
import {
  inspectSitePublicationBuild,
  activateSitePublicationVersion,
  attestSitePublicationBuild,
  attestSitePublicationVersion,
  startSitePublicationBuild,
  readSitePublicationDeployments,
} from "../functions/_lib/services/site-publication-provider";
const config = {
  accountId: "a".repeat(32),
  triggerId: "11111111-1111-4111-8111-111111111111",
  scriptName: "pkic-site",
  branch: "main",
  commitHash: "b".repeat(40),
};
const buildId = "22222222-2222-4222-8222-222222222222";
describe("publication provider boundary", () => {
  it("pins the branch and commit and exposes only the build receipt", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ success: true, result: { build_uuid: buildId, secret: "must-not-escape" } }),
    );
    expect(await startSitePublicationBuild(config, "test-token", fetcher)).toEqual({ buildId });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/builds/triggers/${config.triggerId}/builds`,
    );
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body as string)).toEqual({ branch: "main", commit_hash: config.commitHash });
  });
  it("does not retry an uncertain accepted write or expose provider errors", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("Bearer test-token private provider message");
    });
    await expect(startSitePublicationBuild(config, "test-token", fetcher)).rejects.toMatchObject({
      code: "PROVIDER_WRITE_UNCERTAIN",
      message: "PROVIDER_WRITE_UNCERTAIN",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("classifies a malformed successful POST as uncertain and bounds its body", async () => {
    await expect(
      startSitePublicationBuild(config, "test-token", async () => Response.json({ success: true, result: {} })),
    ).rejects.toMatchObject({ code: "PROVIDER_WRITE_UNCERTAIN" });
    await expect(
      startSitePublicationBuild(config, "test-token", async () => new Response("x".repeat(65537))),
    ).rejects.toMatchObject({ code: "PROVIDER_WRITE_UNCERTAIN" });
  });
  it("distinguishes authoritative rejection from a potentially accepted server failure", async () => {
    await expect(
      startSitePublicationBuild(config, "test-token", async () => new Response("private", { status: 403 })),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    await expect(
      startSitePublicationBuild(config, "test-token", async () => new Response("private", { status: 503 })),
    ).rejects.toMatchObject({ code: "PROVIDER_WRITE_UNCERTAIN" });
  });
  it("retains partial deployment percentages as evidence rather than declaring delivery", async () => {
    const row = {
      id: buildId,
      created_on: "2026-10-04T00:00:00.000Z",
      versions: [{ version_id: buildId, percentage: 50 }],
    };
    expect(
      await readSitePublicationDeployments(config, "test-token", async () =>
        Response.json({ success: true, result: { deployments: [row] } }),
      ),
    ).toEqual([row]);
    await expect(
      readSitePublicationDeployments(config, "test-token", async () =>
        Response.json({
          success: true,
          result: { deployments: [{ ...row, versions: [{ version_id: buildId, percentage: 200 }] }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
  });
});

const attestationConfig = {
  ...config,
  workerTag: "c".repeat(32),
  repoConnectionId: buildId,
  repositoryId: "123",
  providerAccountId: "456",
};
const identity = {
  WORKERS_CI_BUILD_UUID: buildId,
  WORKERS_CI_BRANCH: config.branch,
  WORKERS_CI_COMMIT_SHA: config.commitHash,
};
function record() {
  return {
    build_uuid: buildId,
    status: "stopped",
    build_outcome: "success",
    build_trigger_metadata: {
      branch: config.branch,
      commit_hash: config.commitHash,
      environment_variables: { SECRET: "private" },
    },
    trigger: {
      trigger_uuid: config.triggerId,
      external_script_id: attestationConfig.workerTag,
      repo_connection: { repo_connection_uuid: buildId, repo_id: "123", provider_account_id: "456" },
    },
  };
}
describe("independent provider attestation", () => {
  it("accepts a verified completed build without disclosing provider environment", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, result: record() }));
    expect(await attestSitePublicationBuild(attestationConfig, "token", identity, "completed", fetcher)).toEqual({
      buildId,
      triggerId: config.triggerId,
      branch: config.branch,
      commitHash: config.commitHash,
      phase: "completed",
    });
    expect(fetcher.mock.calls[0]?.length).toBe(2);
  });
  it("rejects forged CI claims before any request", async () => {
    const fetcher = vi.fn();
    await expect(
      attestSitePublicationBuild(
        attestationConfig,
        "token",
        { ...identity, WORKERS_CI_BRANCH: "other" },
        "completed",
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ATTESTATION_MISMATCH" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["build", "trigger", "worker", "repository", "branch", "commit"])("rejects mismatched %s", async (field) => {
    const value = record();
    if (field === "build") value.build_uuid = config.triggerId;
    if (field === "trigger") value.trigger.trigger_uuid = buildId;
    if (field === "worker") value.trigger.external_script_id = "d".repeat(32);
    if (field === "repository") value.trigger.repo_connection.repo_id = "wrong";
    if (field === "branch") value.build_trigger_metadata.branch = "other";
    if (field === "commit") value.build_trigger_metadata.commit_hash = "d".repeat(40);
    await expect(
      attestSitePublicationBuild(attestationConfig, "token", identity, "completed", async () =>
        Response.json({ success: true, result: value }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ATTESTATION_MISMATCH" });
  });
  it("distinguishes failed, incomplete and invalid evidence", async () => {
    for (const [value, code] of [
      [{ ...record(), build_outcome: "fail" }, "PROVIDER_BUILD_FAILED"],
      [{ ...record(), status: "running", build_outcome: null }, "PROVIDER_BUILD_NOT_READY"],
      [{ build_uuid: buildId }, "PROVIDER_RESPONSE_INVALID"],
    ] as const) {
      await expect(
        attestSitePublicationBuild(attestationConfig, "token", identity, "completed", async () =>
          Response.json({ success: true, result: value }),
        ),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      attestSitePublicationBuild(
        attestationConfig,
        "token",
        identity,
        "completed",
        async () => new Response("x".repeat(65537)),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
  });
  it("binds a version read in the configured script to exactly one successful build", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe("GET");
      return Response.json({
        success: true,
        result: url.includes("/versions/") ? { id: buildId } : { builds: { [buildId]: record() } },
      });
    });
    expect(await attestSitePublicationVersion(attestationConfig, "token", identity, buildId, fetcher)).toMatchObject({
      versionId: buildId,
      phase: "completed",
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain(`/workers/scripts/pkic-site/versions/${buildId}`);
    expect(fetcher.mock.calls[1]?.[0]).toContain(`builds/builds?version_ids=${buildId}`);
    await expect(
      attestSitePublicationVersion(attestationConfig, "token", identity, buildId, async (url) =>
        Response.json({
          success: true,
          result: url.includes("/versions/")
            ? { id: buildId }
            : { builds: { [buildId]: record(), [config.triggerId]: record() } },
        }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
  });
});

describe("single publication deployment write", () => {
  it("writes one100percent version only and returns a sanitized receipt", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        result: {
          id: buildId,
          created_on: "2026-10-04T00:00:00.000Z",
          strategy: "percentage",
          versions: [{ version_id: buildId, percentage: 100 }],
          author_email: "private@example.test",
        },
      }),
    );
    expect(await activateSitePublicationVersion(config, "token", buildId, fetcher)).toEqual({
      deploymentId: buildId,
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toEqual({
      strategy: "percentage",
      versions: [{ version_id: buildId, percentage: 100 }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not treat partial or mismatched deployment receipts as an authoritative failure", async () => {
    await expect(
      activateSitePublicationVersion(config, "token", buildId, async () =>
        Response.json({
          success: true,
          result: {
            id: buildId,
            created_on: "2026-10-04T00:00:00.000Z",
            strategy: "percentage",
            versions: [{ version_id: buildId, percentage: 50 }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_WRITE_UNCERTAIN" });
  });
});

describe("terminal pinned build inspection", () => {
  it("accepts terminal failure evidence only from the known configured build", async () => {
    const value = { ...record(), status: "stopped", build_outcome: "cancelled" };
    expect(
      await inspectSitePublicationBuild(attestationConfig, "token", identity, async () =>
        Response.json({ success: true, result: value }),
      ),
    ).toEqual({ buildId, status: "stopped", outcome: "cancelled" });
    await expect(
      inspectSitePublicationBuild(attestationConfig, "token", identity, async () =>
        Response.json({ success: true, result: { ...value, build_uuid: config.triggerId } }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ATTESTATION_MISMATCH" });
  });
});
