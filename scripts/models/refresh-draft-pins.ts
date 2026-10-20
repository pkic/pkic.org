import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { modelRegistrySchema } from "../../assets/shared/model-registry.ts";
import { verifyModelVersion } from "../../site/model-version-source.ts";
import { githubDraftSource } from "./github-draft-source.ts";

export interface DraftSource {
  head(repository: string, branch: string): Promise<string>;
  validated(repository: string, branch: string, commit: string): Promise<boolean>;
  model(repository: string, path: string, commit: string): Promise<string>;
}

/** Only draft source pins change. Registration, release metadata, and defaults remain reviewed inputs. */
export async function refreshDraftPins(source: string, remote: DraftSource) {
  const document = parseDocument(source);
  if (document.errors.length) throw new Error("Invalid model registry YAML");
  const registry = modelRegistrySchema.parse(document.toJS());
  let changes = 0;
  for (const [i, entry] of registry.models.entries()) {
    for (const [j, version] of entry.versions.entries()) {
      if (version.status !== "draft") continue;
      const commit = await remote.head(entry.repository, version.branch);
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Invalid draft commit: ${version.id}`);
      if (commit === version.commit) continue;
      if (!(await remote.validated(entry.repository, version.branch, commit))) continue;
      const bytes = await remote.model(entry.repository, version.sourcePath ?? entry.sourcePath, commit);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      verifyModelVersion(bytes, { ...version, commit, sha256 });
      document.setIn(["models", i, "versions", j, "commit"], commit);
      document.setIn(["models", i, "versions", j, "sha256"], sha256);
      changes++;
    }
  }
  return { changes, source: changes ? document.toString() : source };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  const result = await refreshDraftPins(
    await readFile("data/model-versions.yaml", "utf8"),
    githubDraftSource(process.env.GH_TOKEN),
  );
  if (values.output) {
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, result.source);
  }
  console.log(
    `Validated draft pin updates: ${result.changes}${values.output ? " (build snapshot written)" : " (dry run)"}`,
  );
}
