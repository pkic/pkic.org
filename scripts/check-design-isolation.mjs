/**
 * Keeps the design system isolated from the quarantined legacy stylesheet.
 *
 * Two failures this catches, both of which are silent until someone notices
 * the system has stopped being a system:
 *
 *   1. A component reaching for a Bootstrap class or a `--bs-*` variable.
 *      It works today, breaks when Bootstrap is removed, and means the
 *      component is no longer described by its own stylesheet.
 *   2. A colour, radius, or duration literal in component CSS. One hex in one
 *      component is how a token system quietly stops being the single source.
 *
 * Scope is the design system only — the legacy tree is expected to violate
 * both and is not scanned.
 *
 * Usage: node scripts/check-design-isolation.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();

/**
 * Surfaces that have adopted the design system and must stay free of
 * Bootstrap. This list is the ratchet for the framework removal: a surface
 * joins it once it is clean, and can then never regress. Nothing is ever
 * removed from it.
 *
 * Deliberately NOT a baseline of tolerated violations — a surface is added
 * only after its violations are gone, so the gate always demands zero.
 */
const scanned = [
  "assets/ts/ui",
  "assets/design",
  "layouts/design",
  // Individual files, so a directory can be locked in one surface at a time
  // rather than waiting for every file in it to be migrated at once.
  "layouts/wg/wg-sub.html",
  "layouts/wg/section.html",
];

/** An entry is either a directory prefix or an exact file path. */
function isAdopted(rel) {
  return scanned.some((entry) => rel === entry || rel.startsWith(`${entry}/`));
}

/** Everything still on Bootstrap, measured by `--report` so the remaining
 *  distance is visible without pretending it is acceptable. */
const remaining = ["assets/ts", "assets/js", "assets/scss", "layouts"];

/**
 * Bootstrap utilities and components, matched as WHOLE class tokens.
 *
 * Whole-token matching matters: a substring test flags our own `pk-table` for
 * containing "table", and a gate that cries wolf gets switched off.
 */
const BOOTSTRAP_CLASS =
  /^(btn|btn-[a-z0-9-]+|card|card-[a-z]+|row|col(-[a-z0-9]+)*|d-(none|block|flex|inline|inline-block|grid)|form-(control|select|check|label|text)|input-group|alert|alert-[a-z]+|badge|table|table-[a-z]+|nav|navbar|nav-[a-z]+|modal|modal-[a-z]+|dropdown|dropdown-[a-z]+|spinner-border|visually-hidden|text-(muted|center|start|end)|bg-[a-z]+|fw-[a-z]+|[mp][xytbse]?-[0-5]|g-[0-5]|w-100|h-100|justify-content-[a-z]+|align-items-[a-z]+|border|border-[a-z0-9]+|rounded|rounded-[a-z0-9]+|small|lead|container|container-fluid)$/;

/** Our own classes are never a violation, whatever word they contain. */
function isBootstrapClassList(value) {
  return value
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.startsWith("pk-"))
    .some((token) => BOOTSTRAP_CLASS.test(token));
}

/** A colour literal in any of the forms a stylesheet accepts. */
const COLOUR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\blab\()/;

const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (/\.(css|tsx?)$/.test(entry)) inspect(full);
  }
}

function report(file, lineNumber, line, reason) {
  failures.push(`${relative(root, file)}:${lineNumber}  ${reason}\n    ${line.trim()}`);
}

function inspect(file) {
  const rel = relative(root, file);
  // The generated stylesheet is the one place literals are correct: it is the
  // rendered output of the token module, which is where they are defined.
  const isGeneratedTokens = rel === "assets/design/tokens.generated.css";
  const isTokenSource = rel.startsWith("assets/design/") && /\.ts$/.test(rel);

  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const lineNumber = index + 1;
      const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");

      if (code.includes("--bs-")) {
        report(file, lineNumber, line, "references a Bootstrap custom property");
      }

      const classAttr = code.match(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/);
      if (classAttr && isBootstrapClassList(classAttr[1])) {
        report(file, lineNumber, line, "uses a Bootstrap class name");
      }

      if (file.endsWith(".css") && !isGeneratedTokens && COLOUR_LITERAL.test(code)) {
        report(file, lineNumber, line, "hard-codes a colour instead of reading a token");
      }

      // Only the values that must stay systematic are policed. A gap or an
      // icon's width is legitimately local; a type size, a corner radius, or a
      // duration is not, because those are what make separate components look
      // like one system.
      if (!isTokenSource && !isGeneratedTokens && file.endsWith(".css")) {
        const declaration = code.match(/^\s*(?!--)([a-z-]+)\s*:\s*([^;]+);/);
        if (declaration) {
          const [, property, value] = declaration;
          const usesToken = value.includes("var(");

          // rem/px are absolute; em and % scale with their context and are a
          // legitimate way for an icon to track the text it sits beside.
          if (property === "font-size" && !usesToken && /\b\d+(\.\d+)?(rem|px)\b/.test(value)) {
            report(file, lineNumber, line, "hard-codes a type size instead of reading a token");
          }

          if (/^border(-[a-z]+)?-radius$/.test(property) && !usesToken && /\b\d+(\.\d+)?(rem|px)\b/.test(value)) {
            report(file, lineNumber, line, "hard-codes a corner radius instead of reading a token");
          }

          if (/^(transition|animation)(-duration)?$/.test(property) && !usesToken && /\b\d+(\.\d+)?m?s\b/.test(value)) {
            report(file, lineNumber, line, "hard-codes a duration instead of reading a token");
          }
        }
      }
    });
}

for (const entry of scanned) {
  const full = resolve(root, entry);
  try {
    if (statSync(full).isDirectory()) walk(full);
    else inspect(full);
  } catch {
    // An entry that does not exist yet is not a failure.
  }
}

function countIn(text) {
  let hits = 0;
  for (const match of text.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
    hits += match[1]
      .split(/\s+/)
      .filter((token) => token.length > 0 && !token.startsWith("pk-"))
      .filter((token) => BOOTSTRAP_CLASS.test(token)).length;
  }
  return hits + (text.match(/--bs-/g) ?? []).length;
}

/**
 * `--by-file` ranks what is left, so a migration can be planned against the
 * actual distribution rather than a guess. The work is very unevenly spread:
 * a handful of files carry most of it.
 */
if (process.argv.includes("--by-file")) {
  const rows = [];
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (!/\.(css|scss|tsx?|js|html)$/.test(entry)) continue;
      const rel = relative(root, full);
      if (isAdopted(rel)) continue;
      const hits = countIn(readFileSync(full, "utf8"));
      if (hits > 0) rows.push({ rel, hits });
    }
  };
  for (const dir of remaining) {
    try {
      visit(resolve(root, dir));
    } catch {
      // Absent directories contribute nothing.
    }
  }
  rows.sort((left, right) => right.hits - left.hits);

  const total = rows.reduce((sum, row) => sum + row.hits, 0);
  const shown = rows.slice(0, 25);
  const covered = shown.reduce((sum, row) => sum + row.hits, 0);

  console.log(`[design-isolation] ${String(rows.length)} files still reference Bootstrap (${String(total)} refs).`);
  console.log(`The 25 heaviest carry ${String(covered)} of them (${String(Math.round((covered / total) * 100))}%):\n`);
  for (const row of shown) {
    console.log(`  ${String(row.hits).padStart(5)}  ${row.rel}`);
  }
  process.exit(0);
}

if (process.argv.includes("--report")) {
  const counts = remaining
    .map((dir) => {
      let hits = 0;
      const visit = (current) => {
        for (const entry of readdirSync(current)) {
          const full = join(current, entry);
          if (statSync(full).isDirectory()) {
            visit(full);
            continue;
          }
          if (!/\.(css|scss|tsx?|js|html)$/.test(entry)) continue;
          if (isAdopted(relative(root, full))) continue;
          const text = readFileSync(full, "utf8");
          for (const match of text.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
            hits += match[1]
              .split(/\s+/)
              .filter((token) => token.length > 0 && !token.startsWith("pk-"))
              .filter((token) => BOOTSTRAP_CLASS.test(token)).length;
          }
          hits += (text.match(/--bs-/g) ?? []).length;
        }
      };
      try {
        visit(resolve(root, dir));
      } catch {
        // Absent directories contribute nothing.
      }
      return { dir, hits };
    })
    .sort((left, right) => right.hits - left.hits);

  const total = counts.reduce((sum, entry) => sum + entry.hits, 0);
  console.log("[design-isolation] Bootstrap footprint still to remove (phase 5):");
  for (const { dir, hits } of counts) {
    console.log(`  ${String(hits).padStart(6)}  ${dir}`);
  }
  console.log(`  ${String(total).padStart(6)}  total`);
  console.log(`\n  Adopted and held at zero: ${scanned.join(", ")}`);
}

if (failures.length > 0) {
  console.error(`[design-isolation] ${failures.length} violation(s):\n\n${failures.join("\n\n")}\n`);
  console.error("Design-system files read tokens only. See assets/design/AGENTS.md.");
  process.exit(1);
}

console.log(`[design-isolation] ${scanned.join(", ")} contain no Bootstrap references or hard-coded values`);
