import { cruise, type ICruiseResult } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

describe("Worker startup imports", () => {
  it("defers HTTP registration, scheduled jobs and inbound email until their handlers run", async () => {
    const result = await cruise(["functions/router.ts"], {
      outputType: "json",
      doNotFollow: { path: "node_modules", dependencyTypes: ["dynamic-import"] },
      tsPreCompilationDeps: false,
      enhancedResolveOptions: { extensions: [".ts", ".tsx", ".js", ".mjs", ".json"] },
    });
    const graph = (typeof result.output === "string" ? JSON.parse(result.output) : result.output) as ICruiseResult;
    const modules = new Map(graph.modules.map((module) => [module.source, module]));
    const eager = new Set<string>();
    const pending = ["functions/router.ts"];
    while (pending.length) {
      const source = pending.pop()!;
      if (eager.has(source)) continue;
      eager.add(source);
      for (const dependency of modules.get(source)?.dependencies ?? []) {
        if (!dependency.dynamic) pending.push(dependency.resolved);
      }
    }

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
