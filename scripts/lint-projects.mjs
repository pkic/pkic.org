import { spawnSync } from "node:child_process";

// Fresh serial processes release typed parser programs between project groups.
// The catch-all pass retains coverage for every other file selected by ESLint.
const groups = [
  {
    name: "backend",
    paths: ["functions", "assets/shared", "tests"],
    ignores: ["tests/frontend/**", "tests/tools/**"],
  },
  { name: "frontend", paths: ["assets/ts", "assets/design", "tests/frontend"], ignores: [] },
  { name: "tools", paths: ["*.config.ts", "scripts", "tests/tools"], ignores: [] },
  { name: "site", paths: ["site"], ignores: [] },
  {
    name: "remaining files",
    paths: ["."],
    ignores: [
      "functions/**",
      "assets/shared/**",
      "tests/**",
      "assets/ts/**",
      "assets/design/**",
      "scripts/**",
      "site/**",
      "*.config.ts",
    ],
  },
];

const options = process.argv.slice(2);
if (options.some((option) => option !== "--fix") || options.length > 1) {
  throw new Error("Usage: pnpm run lint or pnpm run lint:fix");
}
for (const group of groups) {
  console.log(`Linting ${group.name}`);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "eslint",
      ...group.paths,
      ...group.ignores.flatMap((pattern) => ["--ignore-pattern", pattern]),
      "--max-warnings",
      "0",
      ...options,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Linting ${group.name} ended with ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
