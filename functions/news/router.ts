import { Hono } from "hono";
import type { Env } from "../_lib/types";
import { getStaticAssetsBinding } from "../_lib/static-assets";

const app = new Hono<{ Bindings: Env }>();
// News browsing resolves through the selected static publication without D1 reads.
app.get("*", async (c) => {
  const assets = getStaticAssetsBinding(c.env);
  return assets ? assets.fetch(c.req.raw) : c.notFound();
});
export default app;
