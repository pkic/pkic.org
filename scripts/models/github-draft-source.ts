import { z } from "zod";
import type { DraftSource } from "./refresh-draft-pins.ts";

const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const runsSchema = z.object({
  workflow_runs: z.array(z.object({ head_sha: z.string(), conclusion: z.string().nullable() })),
});

/** Public model content is fetched by immutable revision; the optional token is sent only to GitHub's API. */
export function githubDraftSource(token?: string): DraftSource {
  async function api(path: string) {
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub draft lookup failed: ${response.status}`);
    return response.json();
  }
  return {
    async head(repository, branch) {
      return commitSchema.parse(await api(`repos/${repository}/commits/${encodeURIComponent(branch)}`)).sha;
    },
    async validated(repository, branch, commit) {
      const query = new URLSearchParams({ branch, head_sha: commit, event: "push", status: "success", per_page: "1" });
      const runs = runsSchema.parse(await api(`repos/${repository}/actions/workflows/validate.yml/runs?${query}`));
      return runs.workflow_runs.some((run) => run.head_sha === commit && run.conclusion === "success");
    },
    async model(repository, path, commit) {
      const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/${path}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Cannot read validated draft source: ${response.status}`);
      return response.text();
    },
  };
}
