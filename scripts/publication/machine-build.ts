import { mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { getPlatformProxy, unstable_readConfig as readConfig } from "wrangler";
import { z } from "zod";
import { first } from "../../functions/_lib/db/queries";
import type { Env } from "../../functions/_lib/types";
import {
  readPublicationAttempt,
  attestPublicationMachineBuild,
} from "../../functions/_lib/services/site-publication-coordinator";
import { readOwnedPublicationRepairMode } from "../../functions/_lib/services/site-publication-reconciliation";
import { completePublicationMachineBuild } from "../../functions/_lib/services/site-publication-activation";
import { sitePublicationCoordinatorConfigSchema } from "../../assets/shared/schemas/site-publication-coordinator";
import { sitePublicationCiIdentitySchema } from "../../assets/shared/schemas/site-publication-provider";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";
import { publicationBindingConfig } from "./binding-config.mjs";
import { verifyReleaseIntegrity, createReleaseIntegrity } from "./release-integrity.mjs";

type MachineEnvironment = Record<string, string | undefined>;
/** Configuration and provider CI identity must agree before native credentials or artifacts are touched. */
export function publicationMachineConfiguration(env: MachineEnvironment) {
  if (!env.SITE_PUBLICATION_COORDINATOR_CONFIG || !env.SITE_PUBLICATION_PROVIDER_TOKEN)
    throw new Error("PUBLICATION_MACHINE_CONFIGURATION_REQUIRED");
  const config = sitePublicationCoordinatorConfigSchema.parse(JSON.parse(env.SITE_PUBLICATION_COORDINATOR_CONFIG));
  const identity = sitePublicationCiIdentitySchema.parse(env);
  if (
    !config.enabled ||
    !config.exclusiveActivationOwner ||
    env.CLOUDFLARE_ENV !== config.environment ||
    identity.WORKERS_CI_BRANCH !== config.provider.branch ||
    identity.WORKERS_CI_COMMIT_SHA.toLowerCase() !== config.provider.commitHash.toLowerCase() ||
    env.PKIC_PUBLICATION_SNAPSHOT
  )
    throw new Error("PUBLICATION_MACHINE_AUTHORITY_INVALID");
  return { config, identity, token: env.SITE_PUBLICATION_PROVIDER_TOKEN };
}
const uploadRecordSchema = z.object({
  type: z.literal("version-upload"),
  version: z.literal(1),
  worker_name: z.string(),
  worker_tag: z.string(),
  version_id: z.uuid(),
});
/** Wrangler's structured receipt is used instead of scraping logs; provider activation independently attests it later. */
export function publicationUploadedVersion(contents: string, scriptName: string, workerTag: string) {
  if (new TextEncoder().encode(contents).byteLength > 64 * 1024)
    throw new Error("PUBLICATION_UPLOAD_RECEIPT_TOO_LARGE");
  const records = contents
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
  const uploads = records.flatMap((record) => {
    const checked = uploadRecordSchema.safeParse(record);
    return checked.success ? [checked.data] : [];
  });
  if (uploads.length !== 1 || uploads[0].worker_name !== scriptName || uploads[0].worker_tag !== workerTag)
    throw new Error("PUBLICATION_UPLOAD_RECEIPT_INVALID");
  return uploads[0].version_id;
}
async function workerPaths(root: string, directory = "", paths: string[] = []) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("PUBLICATION_WORKER_SYMLINK_INVALID");
    if (entry.isDirectory()) await workerPaths(root, path, paths);
    else if (entry.isFile()) paths.push(path);
    else throw new Error("PUBLICATION_WORKER_FILE_INVALID");
    if (paths.length > 10000) throw new Error("PUBLICATION_WORKER_INVENTORY_TOO_LARGE");
  }
  return paths;
}
/** Covers every bundled Worker module and its generated binding/config file, separately from static assets. */
export async function publicationWorkerBundleDigest(configPath: string, environment: string, scriptName: string) {
  const generated = JSON.parse(await readFile(configPath, "utf8")) as {
    main: string;
    name: string;
    targetEnvironment: string;
    assets?: { directory: string };
  };
  if (generated.name !== scriptName || generated.targetEnvironment !== environment || !generated.assets?.directory)
    throw new Error("PUBLICATION_WORKER_TARGET_INVALID");
  const root = dirname(configPath),
    main = resolve(root, generated.main);
  const mainPath = relative(root, main);
  if (!mainPath || mainPath.startsWith("..") || (await lstat(main)).isSymbolicLink())
    throw new Error("PUBLICATION_WORKER_ENTRY_INVALID");
  const files = await workerPaths(root);
  if (!files.includes(mainPath)) throw new Error("PUBLICATION_WORKER_ENTRY_MISSING");
  return {
    digest: (await createReleaseIntegrity(root, files)).digest,
    assets: resolve(root, generated.assets.directory),
  };
}
function run(command: string, args: string[], env: MachineEnvironment) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("PUBLICATION_MACHINE_COMMAND_FAILED");
}
/** Caller input never selects force mode for an owned publication machine. */
export function publicationMachineBuildEnvironment(
  env: MachineEnvironment,
  attemptId: string,
  forceRebuild: boolean,
): MachineEnvironment {
  return {
    ...env,
    PKIC_PUBLICATION_ATTEMPT_ID: attemptId,
    PKIC_PUBLICATION_FORCE_REBUILD: forceRebuild ? "1" : "0",
  };
}
/** Opt-in CI command: upload the complete Worker/assets version, leaving activation to the single scheduled owner. */
export async function runOwnedPublicationBuild(env: MachineEnvironment = process.env) {
  const machine = publicationMachineConfiguration(env);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=all"], {
    encoding: "utf8",
  });
  if (
    head.status !== 0 ||
    dirty.status !== 0 ||
    dirty.stdout.trim() ||
    head.stdout.trim().toLowerCase() !== machine.config.provider.commitHash.toLowerCase()
  )
    throw new Error("PUBLICATION_MACHINE_SOURCE_NOT_PINNED");
  const output = resolve(".cache/publication-machine", machine.identity.WORKERS_CI_BUILD_UUID);
  await mkdir(output, { recursive: true });
  const bindingsPath = resolve(output, "bindings.json");
  const configuration = readConfig({ config: resolve("wrangler.jsonc"), env: machine.config.environment });
  await writeFile(bindingsPath, JSON.stringify(publicationBindingConfig(configuration, machine.config.environment)));
  const platform = await getPlatformProxy<Pick<Env, "DB">>({ configPath: bindingsPath, persist: false, envFiles: [] });
  try {
    const row = await first<{ id: string }>(
      platform.env.DB,
      "SELECT id FROM site_publication_provider_attempts WHERE build_id=? LIMIT 1",
      [machine.identity.WORKERS_CI_BUILD_UUID],
    );
    if (!row) throw new Error("PUBLICATION_MACHINE_ATTEMPT_UNKNOWN");
    const attempt = await readPublicationAttempt(platform.env.DB, row.id);
    if (
      !attempt ||
      attempt.environment !== machine.config.environment ||
      attempt.publicOrigin !== machine.config.publicOrigin ||
      JSON.stringify(attempt.provider) !== JSON.stringify(machine.config.provider)
    )
      throw new Error("PUBLICATION_MACHINE_TARGET_CHANGED");
    await attestPublicationMachineBuild(platform.env.DB, attempt.id, machine.identity, machine.token);
    const forceRebuild = await readOwnedPublicationRepairMode(
      platform.env.DB,
      attempt,
      machine.identity.WORKERS_CI_BUILD_UUID,
    );
    const buildEnvironment = publicationMachineBuildEnvironment(env, attempt.id, forceRebuild);
    run("bash", ["scripts/build.sh"], buildEnvironment);
    const workerConfig = resolve("dist/pkic_org_base/wrangler.json");
    const worker = await publicationWorkerBundleDigest(workerConfig, attempt.environment, attempt.provider.scriptName);
    const release = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(worker.assets, "publication.json"), "utf8")),
    );
    if (
      release.source !== "native" ||
      release.environment !== attempt.environment ||
      release.sourceSequence !== attempt.sourceSequence
    )
      throw new Error("PUBLICATION_MACHINE_RELEASE_CHANGED");
    await verifyReleaseIntegrity(worker.assets, release);
    const receiptPath = resolve(output, `${crypto.randomUUID()}.upload.jsonl`);
    run(
      "pnpm",
      ["exec", "wrangler", "versions", "upload", "--config", workerConfig, "--tag", `publication-${attempt.id}`],
      { ...buildEnvironment, WRANGLER_OUTPUT_FILE_PATH: receiptPath },
    );
    const versionId = publicationUploadedVersion(
      await readFile(receiptPath, "utf8"),
      attempt.provider.scriptName,
      attempt.provider.workerTag,
    );
    await verifyReleaseIntegrity(worker.assets, release);
    if (
      (await publicationWorkerBundleDigest(workerConfig, attempt.environment, attempt.provider.scriptName)).digest !==
      worker.digest
    )
      throw new Error("PUBLICATION_WORKER_CHANGED_DURING_UPLOAD");
    // Never retry a version upload after a missing/uncertain receipt. Its provider attempt stays fenced.
    return await completePublicationMachineBuild(
      platform.env.DB,
      { identityType: "native_build_machine", attemptId: attempt.id, buildId: machine.identity.WORKERS_CI_BUILD_UUID },
      { release, versionId, workerBundleSha256: worker.digest },
    );
  } finally {
    await platform.dispose();
  }
}
