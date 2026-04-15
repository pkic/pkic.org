export function resolveOgImageType(env: { IMAGES?: unknown }): "image/jpeg" | "image/png" {
  return env.IMAGES ? "image/jpeg" : "image/png";
}
