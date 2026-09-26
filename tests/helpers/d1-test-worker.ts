/**
 * Binding host for tests that import their real router or service directly.
 * Do not eagerly import the full application just to apply D1 migrations.
 * SELF-based integration tests must run in the worker-fetch project instead.
 */
export default {
  fetch(): Response {
    throw new Error("SELF.fetch requires the worker-fetch test project with functions/router.ts as its entry point");
  },
};
