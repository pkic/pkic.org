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
const scanned = ["assets/ts/ui", "assets/design"];

/** Bootstrap utilities and components, as whole class tokens. */
const BOOTSTRAP_CLASS =
  /\b(btn|btn-[a-z0-9-]+|card|card-[a-z]+|row|col(-[a-z0-9]+)*|d-(none|block|flex|inline|inline-block|grid)|form-(control|select|check|label|text)|input-group|alert|alert-[a-z]+|badge|table|table-[a-z]+|nav|navbar|nav-[a-z]+|modal|modal-[a-z]+|dropdown|dropdown-[a-z]+|spinner-border|visually-hidden|text-(muted|center|start|end|bg-[a-z]+)|fw-[a-z]+|[mp][xytbse]?-[0-5]|g-[0-5]|w-100|h-100|justify-content-[a-z]+|align-items-[a-z]+|border|border-[a-z0-9]+|bg-[a-z]+|rounded|rounded-[a-z0-9]+|small|lead|container|container-fluid)\b/;

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
      if (classAttr && BOOTSTRAP_CLASS.test(classAttr[1])) {
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

for (const dir of scanned) {
  const full = resolve(root, dir);
  try {
    walk(full);
  } catch {
    // A directory that does not exist yet is not a failure.
  }
}

if (failures.length > 0) {
  console.error(`[design-isolation] ${failures.length} violation(s):\n\n${failures.join("\n\n")}\n`);
  console.error("Design-system files read tokens only. See assets/design/AGENTS.md.");
  process.exit(1);
}

console.log(`[design-isolation] ${scanned.join(", ")} contain no Bootstrap references or hard-coded values`);
