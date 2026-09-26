import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function pullRequestBaseFromEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    return event.pull_request?.base?.sha ?? null;
  } catch {
    return null;
  }
}

function hasWorkingTreeChanges() {
  return run("git", ["status", "--porcelain", "--untracked-files=all"]).length > 0;
}

function comparisonBase() {
  const explicit = process.env.DUPLICATION_BASE?.trim();
  if (explicit) return explicit;
  const pullRequestBase = pullRequestBaseFromEvent();
  if (pullRequestBase) return pullRequestBase;
  if (hasWorkingTreeChanges()) return "HEAD";
  return run("git", ["rev-parse", "HEAD^"]);
}

function changedLineRanges(base) {
  const diff = run("git", [
    "diff",
    "--unified=0",
    "--no-ext-diff",
    base,
    "--",
    "functions",
    "assets/shared",
    "assets/ts",
    "assets/js",
    "scripts",
    "static/scripts",
  ]);
  const ranges = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (!file || !line.startsWith("@@")) continue;
    const match = line.match(/\+(\d+)(?:,(\d+))?/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) continue;
    const fileRanges = ranges.get(file) ?? [];
    fileRanges.push({ start, end: start + count - 1 });
    ranges.set(file, fileRanges);
  }
  return ranges;
}

function matchesReportPath(file, reportPath) {
  return file === reportPath || file.endsWith(`/${reportPath}`);
}

function overlapsChangedLines(fileInfo, ranges) {
  for (const [file, fileRanges] of ranges) {
    if (!matchesReportPath(file, fileInfo.name)) continue;
    if (fileRanges.some((range) => range.start <= fileInfo.end && range.end >= fileInfo.start)) return file;
  }
  return null;
}

const jscpdBinary = process.platform === "win32" ? "node_modules/.bin/jscpd.cmd" : "node_modules/.bin/jscpd";
const scan = spawnSync(jscpdBinary, [], { encoding: "utf8", stdio: "inherit" });
if (scan.status !== 0) process.exit(scan.status ?? 1);

const base = comparisonBase();
const ranges = changedLineRanges(base);
const report = JSON.parse(readFileSync(".jscpd-report/jscpd-report.json", "utf8"));
const violations = [];
for (const duplicate of report.duplicates ?? []) {
  const firstChangedFile = overlapsChangedLines(duplicate.firstFile, ranges);
  const secondChangedFile = overlapsChangedLines(duplicate.secondFile, ranges);
  if (!firstChangedFile && !secondChangedFile) continue;
  violations.push({ duplicate, firstChangedFile, secondChangedFile });
}

if (violations.length > 0) {
  process.stderr.write(`\nDuplication intersects code changed since ${base}:\n`);
  for (const { duplicate, firstChangedFile, secondChangedFile } of violations) {
    const firstName = firstChangedFile ?? duplicate.firstFile.name;
    const secondName = secondChangedFile ?? duplicate.secondFile.name;
    process.stderr.write(
      `- ${duplicate.tokens} tokens: ${firstName}:${duplicate.firstFile.start} and ${secondName}:${duplicate.secondFile.start}\n`,
    );
  }
  process.stderr.write("Extract or reuse a shared abstraction instead of suppressing the clone.\n");
  process.exit(1);
}

process.stdout.write(`No duplicated block intersects code changed since ${base}.\n`);
