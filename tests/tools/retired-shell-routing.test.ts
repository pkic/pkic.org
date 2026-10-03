import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

import { describe, expect, it } from "vitest";

const configPath = resolve(import.meta.dirname, "../../wrangler.jsonc");
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));

describe("static public routing", () => {
  it("limits Worker-first routing to APIs and runtime actions in every environment", () => {
    for (const environment of Object.values(parsed.config.env) as { assets: { run_worker_first: string[] } }[]) {
      const rules = environment.assets.run_worker_first;
      const workerFirst = (path: string) =>
        rules.some((rule) => (rule.endsWith("*") ? path.startsWith(rule.slice(0, -1)) : path === rule));
      for (const path of ["/api/v1/openapi.json", "/r/example", "/donate/r/example"]) {
        expect(workerFirst(path), path).toBe(true);
      }
      for (const path of [
        "/",
        "/join/",
        "/events/2026/example/",
        "/events/register/",
        "/portal/",
        "/members/example/",
        "/sitemap.xml",
        "/robots.txt",
        "/pagefind/pagefind.js",
        "/_published/media/example.webp",
        "/og/example/og.jpg",
        "/_published/social/example.jpg",
      ]) {
        expect(workerFirst(path), path).toBe(false);
      }
    }
  });
});
