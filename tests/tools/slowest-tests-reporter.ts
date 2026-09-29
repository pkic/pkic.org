import type { Reporter, TestModule } from "vitest/node";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
      .sort((left, right) => right.duration - left.duration);

    // Opt-in machine-readable profiles stay outside source control. Include
    // setup/import costs: case durations alone hide runtime startup overhead.
    const profilePath = process.env.PKIC_TEST_PROFILE_PATH;
    if (profilePath) {
      mkdirSync(dirname(profilePath), { recursive: true });
      writeFileSync(
        profilePath,
        JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            node: process.version,
            modules: testModules.map((module) => ({
              file: module.relativeModuleId,
              ...module.diagnostic(),
            })),
            tests,
          },
          null,
          2,
        ) + "\n",
      );
    }

    if (tests.length === 0) return;

    console.log(`\nSlowest test cases (top ${Math.min(tests.length, LIMIT)})`);
    for (const test of tests.slice(0, LIMIT)) {
      console.log(`${test.duration.toFixed(0).padStart(6)} ms  ${test.file} > ${test.name}`);
    }
  }
}
