import { execFileSync } from "node:child_process";

/** Workers Previews serve a branch at <preview>-<worker>.<subdomain>.workers.dev. */
export const PREVIEW_WORKER_HOST_SUFFIX = "-pkic-org.pkic.workers.dev";

/** The Preview URL for a non-production branch, or null for main and unnamed branches. */
export function workersPreviewBaseUrl(branch) {
  if (!branch || branch.toLowerCase() === "main") return null;
  const label = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return label ? `https://${label}${PREVIEW_WORKER_HOST_SUFFIX}` : null;
}

function currentGitBranch() {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

/**
 * The origin-bound vars of one Preview, from the Workers Builds branch or the
 * current git branch. A preview build without a branch fails rather than
 * shipping another Preview's or production's origin.
 */
export function previewOriginVars(branch = process.env.WORKERS_CI_BRANCH || currentGitBranch()) {
  const origin = workersPreviewBaseUrl(branch);
  if (!origin) {
    throw new Error("A preview build needs a non-main branch: set WORKERS_CI_BRANCH or build from a named git branch.");
  }
  return { APP_BASE_URL: origin, WEBAUTHN_ORIGIN: origin };
}
