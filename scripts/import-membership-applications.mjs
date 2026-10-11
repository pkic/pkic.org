import { runCli } from "./membership-application-import/cli.mjs";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  // Never print stack traces, API response bodies, input JSON, or environment values.
  console.error(error.code ? `Import stopped (${error.code}); check file access and paths.` : error.message);
  process.exitCode = 1;
}
