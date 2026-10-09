/** Workers Previews serve a branch at <preview>-<worker>.<subdomain>.workers.dev. */
export const PREVIEW_WORKER_HOST_SUFFIX = "-pkic-org.pkic.workers.dev";

/** The Preview URL for a non-production CI branch, or null for main and local builds. */
export function workersPreviewBaseUrl(branch) {
  if (!branch || branch.toLowerCase() === "main") return null;
  const label = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return label ? `https://${label}${PREVIEW_WORKER_HOST_SUFFIX}` : null;
}
