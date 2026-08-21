import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_MAX_LINES = 600;
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".json", ".jsonc", ".md", ".sql", ".yml", ".yaml", ".mjs"]);
const IGNORE_DIRS = new Set([".git", "node_modules", "public", "resources", "content"]);
const SCOPED_ROOTS = ["assets", "functions", "tests", "docs/events-backend", "migrations", "scripts", "shared"];
const SCOPED_FILES = new Set(["package.json", "tsconfig.json", "wrangler.jsonc"]);
const EXEMPT_PATTERNS = [
  /^migrations\/.*\.sql$/,
  /^scripts\/seed-email-templates\.mjs$/,
  /^tests\/.*\.(test|spec)\.ts$/,
];

function isInScope(relPath) {
  if (SCOPED_FILES.has(relPath)) {
    return true;
  }

  return SCOPED_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

function isExempt(relPath) {
  return EXEMPT_PATTERNS.some((pattern) => pattern.test(relPath));
}

function maxLinesFor(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  // HTTP adapters should remain substantially smaller than domain services.
  if (normalized.startsWith("functions/api/") && normalized.endsWith(".ts")) return 300;
  // Legacy browser scripts are being modularized incrementally; keep their
  // ceiling explicit and lower than the previous repository-wide 1,000 lines.
  if (normalized.startsWith("assets/js/") && normalized.endsWith(".js")) return 800;
  return DEFAULT_MAX_LINES;
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

    if (isExempt(rel.split(path.sep).join("/"))) {
      continue;
    }

    const text = fs.readFileSync(fullPath, "utf8");
    const lines = text.split(/\r?\n/).length;
    const maxLines = maxLinesFor(rel);
    if (lines > maxLines) {
      out.push({ rel, lines, maxLines });
    }
  }
}

const violations = [];
walk(ROOT, violations);

if (violations.length > 0) {
  console.error(`Found ${violations.length} oversized file(s):`);
  for (const item of violations) {
    console.error(`- ${item.rel}: ${item.lines} lines (maximum ${item.maxLines})`);
  }
  process.exit(1);
}

console.log(`All checked files satisfy their architecture-specific line limits.`);
