/**
 * Selects the Wrangler arguments for a D1 data target. Workers Previews share
 * pkic-db-preview, which wrangler.jsonc declares as the production DB binding's
 * preview_database_id; `--preview` selects it. Commands without a --preview
 * option (such as `d1 export`) must address pkic-db-preview by name instead.
 */
export const PREVIEW_DATABASE_NAME = "pkic-db-preview";

export function wranglerTargetArgs(target) {
  if (target === "preview") return ["--env", "production", "--preview"];
  if (target === "local" || target === "production") return ["--env", target];
  throw new Error(`Unsupported Wrangler target: ${String(target)}`);
}
