import { execFileSync } from "node:child_process";

/**
 * The build's release: the commit it was built from. The Worker and the
 * pages of one deploy carry the same one, so a long-running page, such as an
 * event screen, can tell that the server now runs a newer release.
 */
export function releaseId() {
  if (process.env.PKIC_RELEASE) return process.env.PKIC_RELEASE;
  const commit = process.env.WORKERS_CI_COMMIT_SHA;
  if (commit) return commit.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}
