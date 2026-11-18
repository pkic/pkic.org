import { execFileSync } from "node:child_process";

import { PREVIEW_HOSTNAME } from "../../assets/shared/preview-domain.ts";

/** The custom URL for a named Preview, including the stable Preview of main. */
export function workersPreviewBaseUrl(branch) {
  if (!branch) return null;
  const label = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // Keep branches whose slug looks like main from targeting its Preview hostname.
  if (!label || (label === "main" && branch !== "main")) return null;
  return `https://${label}.${PREVIEW_HOSTNAME}`;
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
    throw new Error("A preview build needs a named branch with a valid Preview hostname.");
  }
  return { APP_BASE_URL: origin, WEBAUTHN_ORIGIN: origin };
}
