import type { Env, StaticAssetsBinding } from "./types";

/** Resolves the production or local static-assets binding through one boundary. */
export function getStaticAssetsBinding(env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC">): StaticAssetsBinding | undefined {
  return env.ASSETS ?? env.ASSETS_PUBLIC;
}
