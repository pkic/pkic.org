import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const repositoryRoot = process.cwd();
const sourceRoot = join(repositoryRoot, "functions");
const wildcardProjection = /\bSELECT\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?\*/giu;
const violations = [];

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (!entry.isFile() || extname(entry.name) !== ".ts") continue;

    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(wildcardProjection)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${relative(repositoryRoot, path)}:${line}`);
    }
  }
}

scan(sourceRoot);

if (violations.length > 0) {
  process.stderr.write("Production D1 reads must use explicit projections; wildcard SELECT found at:\n");
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exit(1);
}

process.stdout.write("All production D1 reads use explicit projections.\n");
