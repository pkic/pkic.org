import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MAX_LINES = 500;
const EXTENSIONS = new Set([".ts", ".js", ".json", ".jsonc", ".md", ".sql", ".yml", ".yaml", ".mjs"]);
const IGNORE_DIRS = new Set([".git", "node_modules", "public", "resources", "content", "assets"]);
const SCOPED_ROOTS = ["functions", "tests", "docs/events-backend", "migrations", "scripts", "shared"];
const SCOPED_FILES = new Set(["package.json", "tsconfig.json", "wrangler.jsonc"]);

function isInScope(relPath) {
  if (SCOPED_FILES.has(relPath)) {
    return true;
  }

  return SCOPED_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(ROOT, fullPath);

    if (entry.isDirectory()) {
      if ([...IGNORE_DIRS].some((ignored) => rel.startsWith(ignored))) {
        continue;
      }
      walk(fullPath, out);
      continue;
    }

    if (!EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    if (!isInScope(rel)) {
      continue;
    }

    const text = fs.readFileSync(fullPath, "utf8");
    const lines = text.split(/\r?\n/).length;
    if (lines > MAX_LINES) {
      out.push({ rel, lines });
    }
  }
}

const violations = [];
walk(ROOT, violations);

if (violations.length > 0) {
  console.error(`Found ${violations.length} file(s) exceeding ${MAX_LINES} lines:`);
  for (const item of violations) {
    console.error(`- ${item.rel}: ${item.lines} lines`);
  }
  process.exit(1);
}

console.log(`All checked files are <= ${MAX_LINES} lines.`);
