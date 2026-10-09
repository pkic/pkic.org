/**
 * Selects the Wrangler configuration for a data target. Local and production
 * are Wrangler environments in wrangler.jsonc. Workers Previews have no
 * environment of their own: their shared D1 database is addressed through the
 * documented preview migrations config, never through a production binding.
 */
export const PREVIEW_RESOURCES_CONFIG = "wrangler.preview-migrations.jsonc";

const D1_BINDINGS = { local: "DB", preview: "PREVIEW_DB", production: "DB" };

export function wranglerTargetArgs(target) {
  if (target === "preview") return ["--config", PREVIEW_RESOURCES_CONFIG];
  if (target === "local" || target === "production") return ["--env", target];
  throw new Error(`Unsupported Wrangler target: ${String(target)}`);
}

export function d1BindingForTarget(target) {
  const binding = D1_BINDINGS[target];
  if (!binding) throw new Error(`Unsupported Wrangler target: ${String(target)}`);
  return binding;
}
