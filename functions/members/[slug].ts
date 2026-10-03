import type { Context } from "hono";
import type { Env } from "../_lib/types";
import { getStaticAssetsBinding } from "../_lib/static-assets";

/** Member browsing serves the approved publication; missing pages never read D1. */
export async function onRequestGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const binding = getStaticAssetsBinding(c.env);
  if (!binding) return new Response("Not found", { status: 404 });
  return binding.fetch(c.req.raw);
}
