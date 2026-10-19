import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  publicationMachineConfiguration,
  publicationMachineBuildEnvironment,
  publicationUploadedVersion,
  publicationWorkerBundleDigest,
  runOwnedPublicationBuild,
} from "../../scripts/publication/machine-build";
import { sitePublicationCoordinatorConfigSchema } from "../../assets/shared/schemas/site-publication-coordinator";
const provider = {
  accountId: "a".repeat(32),
  triggerId: "11111111-1111-4111-8111-111111111111",
  scriptName: "pkic-site",
  branch: "main",
  commitHash: "b".repeat(40),
  workerTag: "c".repeat(32),
  repoConnectionId: "22222222-2222-4222-8222-222222222222",
  repositoryId: "123",
  providerAccountId: "456",
};
const config = {
  enabled: true,
  exclusiveActivationOwner: true,
  environment: "production",
  publicOrigin: "https://pkic.org",
  provider,
};
const environment = {
  SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify(config),
  SITE_PUBLICATION_PROVIDER_TOKEN: "server-only-provider-token",
  CLOUDFLARE_ENV: "production",
  WORKERS_CI_BUILD_UUID: "33333333-3333-4333-8333-333333333333",
  WORKERS_CI_BRANCH: "main",
  WORKERS_CI_COMMIT_SHA: provider.commitHash,
};
describe("native complete Worker publication command", () => {
  it("refuses unapproved ownership, mismatched CI identity and fixture input before accessing credentials or starting commands", async () => {
    await expect(runOwnedPublicationBuild({})).rejects.toThrow("CONFIGURATION_REQUIRED");
    expect(publicationMachineConfiguration(environment).config.environment).toBe("production");
    for (const invalid of [
      { ...environment, PKIC_PUBLICATION_SNAPSHOT: "fixture.json" },
      { ...environment, CLOUDFLARE_ENV: "preview" },
      { ...environment, WORKERS_CI_COMMIT_SHA: "f".repeat(40) },
      {
        ...environment,
        SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify({ ...config, exclusiveActivationOwner: false }),
      },
    ])
      expect(() => publicationMachineConfiguration(invalid)).toThrow("AUTHORITY_INVALID");
  });
  it("accepts one structured upload for the pinned Worker and refuses duplicate, foreign or malformed receipts", () => {
    const receipt = {
      type: "version-upload",
      version: 1,
      worker_name: provider.scriptName,
      worker_tag: provider.workerTag,
      version_id: "44444444-4444-4444-8444-444444444444",
    };
    expect(publicationUploadedVersion(JSON.stringify(receipt), provider.scriptName, provider.workerTag)).toBe(
      receipt.version_id,
    );
    for (const value of [
      JSON.stringify({ ...receipt, worker_tag: "f".repeat(32) }),
      `${JSON.stringify(receipt)}\n${JSON.stringify(receipt)}`,
      "{}",
      "not-json",
    ])
      expect(() => publicationUploadedVersion(value, provider.scriptName, provider.workerTag)).toThrow();
  });
  it("covers imported Worker modules and config in the bundle digest while enforcing the selected target", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "pkic-machine-worker-"));
    try {
      await mkdir(resolve(root, "chunks"));
      const file = resolve(root, "wrangler.json");
      await writeFile(
        file,
        JSON.stringify({
          name: provider.scriptName,
          main: "index.js",
          targetEnvironment: "production",
          assets: { directory: "../client" },
        }),
      );
      await writeFile(resolve(root, "index.js"), "import './chunks/worker.js';");
      await writeFile(resolve(root, "chunks/worker.js"), "export const approved = true;");
      const before = await publicationWorkerBundleDigest(file, "production", provider.scriptName);
      await writeFile(resolve(root, "chunks/worker.js"), "export const approved = false;");
      expect((await publicationWorkerBundleDigest(file, "production", provider.scriptName)).digest).not.toBe(
        before.digest,
      );
      await expect(publicationWorkerBundleDigest(file, "preview", provider.scriptName)).rejects.toThrow(
        "TARGET_INVALID",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("canonical periodic repair machine configuration", () => {
  it("defaults to daily repair and validates an explicit bounded cadence", () => {
    expect(sitePublicationCoordinatorConfigSchema.parse(config).repairIntervalSeconds).toBe(86400);
    expect(
      sitePublicationCoordinatorConfigSchema.parse({ ...config, repairIntervalSeconds: 3600 }).repairIntervalSeconds,
    ).toBe(3600);
    for (const repairIntervalSeconds of [0, 59, 604801, 3600.5])
      expect(() => sitePublicationCoordinatorConfigSchema.parse({ ...config, repairIntervalSeconds })).toThrow();
  });
  it("ignores incoming force state and uses only the native owned repair decision", () => {
    const attemptId = "77777777-7777-4777-8777-777777777777";
    const ordinary = publicationMachineBuildEnvironment(
      { ...environment, PKIC_PUBLICATION_FORCE_REBUILD: "1" },
      attemptId,
      false,
    );
    expect(ordinary.PKIC_PUBLICATION_FORCE_REBUILD).toBe("0");
    expect(ordinary.PKIC_PUBLICATION_ATTEMPT_ID).toBe(attemptId);
    expect(ordinary.SITE_PUBLICATION_PROVIDER_TOKEN).toBe(environment.SITE_PUBLICATION_PROVIDER_TOKEN);
    const repair = publicationMachineBuildEnvironment(
      { ...environment, PKIC_PUBLICATION_FORCE_REBUILD: "0" },
      attemptId,
      true,
    );
    expect(repair.PKIC_PUBLICATION_FORCE_REBUILD).toBe("1");
    expect(repair.PKIC_PUBLICATION_ATTEMPT_ID).toBe(attemptId);
  });
});
