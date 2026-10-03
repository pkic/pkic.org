import { performance } from "node:perf_hooks";

/** Aggregate publication stage timings without logging once per page. */
export function publicationTimings() {
  const started = performance.now();
  const stages = new Map();
  function record(stage, start) {
    const entry = stages.get(stage) ?? { milliseconds: 0, calls: 0 };
    entry.milliseconds += performance.now() - start;
    entry.calls += 1;
    stages.set(stage, entry);
  }
  return {
    async measure(stage, operation) {
      const start = performance.now();
      try {
        return await operation();
      } finally {
        record(stage, start);
      }
    },
    measureSync(stage, operation) {
      const start = performance.now();
      try {
        return operation();
      } finally {
        record(stage, start);
      }
    },
    report(status) {
      const total = performance.now() - started;
      let measured = 0;
      for (const [stage, { milliseconds, calls }] of stages) {
        measured += milliseconds;
        console.log(`[publication] ${stage}: ${(milliseconds / 1000).toFixed(2)}s (${calls} operations)`);
      }
      console.log(`[publication] other processing: ${(Math.max(0, total - measured) / 1000).toFixed(2)}s`);
      console.log(`[publication] post-processing ${status}: ${(total / 1000).toFixed(2)}s total`);
    },
  };
}
