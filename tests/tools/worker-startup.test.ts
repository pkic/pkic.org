import { cruise, type ICruiseResult } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

async function startupGraph(entry: string, extraRoots: string[] = []) {
  const result = await cruise([entry, ...extraRoots], {
    outputType: "json",
    doNotFollow: { path: "node_modules", dependencyTypes: ["dynamic-import"] },
    tsPreCompilationDeps: false,
    enhancedResolveOptions: { extensions: [".ts", ".tsx", ".js", ".mjs", ".json"] },
  });
  const graph = (typeof result.output === "string" ? JSON.parse(result.output) : result.output) as ICruiseResult;
  const modules = new Map(graph.modules.map((module) => [module.source, module]));
  const eager = new Set<string>();
  const pending = [entry];
  while (pending.length) {
    const source = pending.pop()!;
    if (eager.has(source)) continue;
    eager.add(source);
    for (const dependency of modules.get(source)?.dependencies ?? []) {
      if (!dependency.dynamic) pending.push(dependency.resolved);
    }
  }

  return { modules, eager };
}

describe("Worker startup imports", () => {
  it("defers HTTP registration, scheduled jobs and inbound email until their handlers run", async () => {
    const { modules, eager } = await startupGraph("functions/router.ts");

    const deferred = [
      "functions/http-router.ts",
      "functions/_lib/services/scheduled-jobs/registry.ts",
      "functions/_lib/services/calendar-rsvp-email-ingest.ts",
    ];
    for (const source of deferred) {
      // The graph must include the implementation; excluding it from analysis
      // must not turn an eager import into an apparent pass.
      expect(modules.has(source), source).toBe(true);
      expect(eager.has(source), `${source} initializes during isolate startup`).toBe(false);
    }
    expect([...eager].filter((source) => source.startsWith("functions/api/"))).toEqual([]);
  });
});

it("defers default badge artwork and fonts until a generic badge is generated", async () => {
  const builder = "assets/shared/badge-generic-template.ts";
  const { modules, eager } = await startupGraph("functions/http-router.ts", [builder]);
  expect(eager.has("functions/_lib/services/event-participation/badge-print-branding.ts")).toBe(true);
  for (const source of [
    builder,
    "assets/shared/badge-default-template-fonts.ts",
    "assets/shared/badge-generic-template-assets.ts",
  ]) {
    expect(modules.has(source), source).toBe(true);
    expect(eager.has(source), `${source} initializes with the HTTP router`).toBe(false);
  }
});
