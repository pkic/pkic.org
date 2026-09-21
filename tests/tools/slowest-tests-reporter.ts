import type { Reporter, TestModule } from "vitest/node";

const LIMIT = 10;

/** Reports individual test duration without replacing Vitest's normal output. */
export default class SlowestTestsReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const tests = testModules
      .flatMap((testModule) => [...testModule.children.allTests()])
      .map((test) => ({
        duration: test.diagnostic()?.duration,
        file: test.module.relativeModuleId,
        name: test.fullName,
      }))
      .filter((test): test is { duration: number; file: string; name: string } => test.duration !== undefined)
      .sort((left, right) => right.duration - left.duration)
      .slice(0, LIMIT);

    if (tests.length === 0) return;

    console.log(`\nSlowest test cases (top ${tests.length})`);
    for (const test of tests) {
      console.log(`${test.duration.toFixed(0).padStart(6)} ms  ${test.file} > ${test.name}`);
    }
  }
}
