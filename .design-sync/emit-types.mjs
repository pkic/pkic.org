#!/usr/bin/env node
/**
 * Generate the design system's .d.ts tree for design-sync.
 *
 * The repo ships no `dist/`, so the converter's prop extractor has no
 * declarations to read and every `<Name>Props` degrades to an empty index
 * signature — which is the one artifact the design agent codes against.
 *
 * Two steps:
 *   1. `tsc --emitDeclarationOnly` over `assets/ts/ui` into `types/`.
 *   2. Rewrite Preact type references to their React equivalents.
 *
 * Step 2 matters as much as step 1: the converter strips inherited DOM props
 * by checking whether a prop's declaration lives in React/DOM types. Preact's
 * are structurally equivalent but unrecognized, so without the rewrite every
 * component's contract is buried under ~90 leaked HTML attributes (in both
 * `class`/`className` casings, wrapped in `JSX.SignalLike<>`), and the emitted
 * file references `SignalLike`/`VNode`/`Booleanish` it never imports.
 *
 * Type-check errors from tsc are expected and ignored: React's JSX types reject
 * the `class=` attribute this DS uses throughout. They are confined to
 * component bodies, never the exported Props interfaces, and tsc still emits.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

try {
  execFileSync("pnpm", ["exec", "tsc", "-p", ".design-sync/tsconfig.types.json"], {
    cwd: ROOT, stdio: "pipe",
  });
} catch {
  /* expected: `class=` vs React's JSX types. Declarations are still emitted. */
}

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".d.ts")) out.push(p);
  }
  return out;
};

/*
 * Fail loudly if tsc emitted into the source tree.
 *
 * When a file falls outside `rootDir`, tsc reports TS6059 and then emits that
 * file's declaration NEXT TO ITS SOURCE rather than under `outDir` — and since
 * this script deliberately swallows tsc's errors, that lands silently. Three
 * strays sat in `assets/` for an hour before anyone noticed. They are worse
 * than untidy: `tsconfig.frontend.json` includes `assets/**\/*.ts`, so a stray
 * `.d.ts` beside its `.ts` shadows the real module in resolution and then rots
 * as the source moves on.
 */
const strays = walk(join(ROOT, "assets"));
if (strays.length > 0) {
  console.error("emit-types: tsc emitted declarations into the source tree:");
  for (const f of strays) console.error(`  ${f.slice(ROOT.length + 1)}`);
  console.error("Fix `rootDir` in .design-sync/tsconfig.types.json, delete these, and re-run.");
  process.exit(1);
}

let changed = 0;
for (const file of walk(join(ROOT, "types"))) {
  const before = readFileSync(file, "utf8");
  let s = before;

  // Preact's JSX namespace -> React's flat helper types.
  s = s.replace(/\bJSX\.IntrinsicElements\b/g, "React.JSX.IntrinsicElements");
  s = s.replace(/\bJSX\.Element\b/g, "React.ReactElement");
  s = s.replace(/\bJSX\.CSSProperties\b/g, "React.CSSProperties");
  s = s.replace(/\bJSX\.([A-Za-z]+HTMLAttributes)\b/g, "React.$1");
  s = s.replace(/\bJSX\.HTMLAttributes\b/g, "React.HTMLAttributes");
  s = s.replace(/\bComponentChildren\b/g, "React.ReactNode");
  s = s.replace(/\bComponentChild\b/g, "React.ReactNode");

  // Drop the now-unused preact imports and bind the React namespace instead.
  s = s.replace(/^import type \{[^}]*\} from ["']preact(?:\/hooks)?["'];\n/gm, "");
  s = s.replace(/^import \{[^}]*\} from ["']preact(?:\/hooks)?["'];\n/gm, "");
  if (/\bReact\./.test(s) && !/^import type \* as React from ["']react["'];/m.test(s)) {
    s = `import type * as React from "react";\n${s}`;
  }

  if (s !== before) { writeFileSync(file, s); changed++; }
}
console.log(`types/: ${walk(join(ROOT, "types")).length} .d.ts emitted, ${changed} rewritten to React types`);
