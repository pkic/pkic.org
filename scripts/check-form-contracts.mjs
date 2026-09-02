/**
 * Keeps forms on the shared contract and the shared primitives.
 *
 * One basis for validation: a field's state comes from the shared Zod request
 * contract through `useContractForm`, never from a boolean a form invents.
 * One set of primitives: a choice control is `Checkbox`/`Radio`, a link drawn
 * as a button is `ButtonLink`, a field is `Field`, and a `pk-` class exists in
 * a stylesheet before code may name it.
 *
 * Usage: node scripts/check-form-contracts.mjs [--report]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const reportOnly = process.argv.includes("--report");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const code = walk(join(root, "assets/ts")).filter((f) => /\.(tsx?|css)$/.test(f));
const styles = [...walk(join(root, "assets/design")), ...walk(join(root, "assets/scss")), ...code]
  .filter((f) => /\.(css|scss)$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const defined = new Set([...styles.matchAll(/\.(pk-[A-Za-z0-9_-]+)/g)].map((m) => m[1]));

/** The primitives themselves and the DOM-driven legacy widgets are the exceptions. */
const PRIMITIVE = /assets\/ts\/(ui|shared\/form)\//;

const findings = [];
for (const file of code.filter((f) => /\.tsx?$/.test(f))) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const primitive = PRIMITIVE.test(rel);
  let inClassList = false;

  lines.forEach((line, index) => {
    const at = `${rel}:${index + 1}`;
    if (!primitive) {
      // A choice control drawn by hand in the system's vocabulary. A legacy
      // surface still on its own stylesheet (no `pk-` class in reach) is a
      // migration, not a primitive swap, and is left to that migration.
      const around = lines.slice(Math.max(0, index - 8), index + 8).join("\n");
      if (
        /type="(checkbox|radio)"/.test(line) &&
        /<input/.test(lines.slice(Math.max(0, index - 6), index + 1).join("\n")) &&
        /\bpk-/.test(around)
      ) {
        findings.push(`${at}: raw choice control — use Checkbox or Radio from ui/Checkbox`);
      }
      if (
        /<a\b[^>]*class="[^"]*\bpk-btn\b/.test(line) ||
        (/class="[^"]*\bpk-btn\b/.test(line) && /<a\b/.test(lines.slice(Math.max(0, index - 8), index).join("\n")))
      ) {
        findings.push(`${at}: link drawn as a button by hand — use ButtonLink from ui/Button`);
      }
      if (/class="pk-field(\s|")/.test(line)) {
        findings.push(`${at}: hand-built field markup — use Field from ui/Field`);
      }
      if (/class="pk-input(\s|"|-)/.test(line)) {
        findings.push(`${at}: hand-built control markup — use TextInput, Textarea or Select from ui/TextControl`);
      }
    }
    // A class the code names must exist in a stylesheet. Dynamic prefixes
    // (`pk-btn--${variant}`) end in a dash and are checked by their consumers.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments
    // Only a line that names classes is held to the stylesheet: an id, a
    // storage key or an aria reference may look like one and is not one.
    if (/class(es|Name|List)?\s*[:=]\s*\[|class=\{\[/.test(line)) inClassList = true;
    const classBearing = inClassList || /\bclass(es|Name|List)?\b/.test(line);
    if (inClassList && /\]/.test(line)) inClassList = false;
    if (!classBearing) return;
    for (const match of line.matchAll(/(?<![-\w#])pk-[A-Za-z0-9_]+(?:[-_][A-Za-z0-9_]+)*/g)) {
      const name = match[0];
      const after = line[match.index + name.length] ?? "";
      if (name === "pk" || defined.has(name)) continue;
      if (after === "-" || after === "$") continue; // a prefix completed at render time
      if (line.includes(`--${name}`)) continue; // a token, not a class
      if (new RegExp(`id=["{\`]?${name}|"${name}"\\)|'${name}'\\)`).test(line)) continue; // an id or a key
      findings.push(`${at}: class "${name}" is defined in no stylesheet`);
    }
  });

  // A form on the contract lets only the contract speak: the browser's own
  // bubble for `required` or `type` would be a second validator.
  if (!primitive && /useContractForm/.test(source)) {
    lines.forEach((line, index) => {
      if (/<form\b/.test(line) && !/noValidate/.test(lines.slice(index, index + 4).join(" "))) {
        findings.push(
          `${rel}:${index + 1}: form on useContractForm without noValidate — the contract is the one validator`,
        );
      }
    });
  }
  // A Field with a state must take it from the shared contract.
  if (!primitive && /<Field\b[\s\S]*?\bstate=/.test(source) && !/useContractForm/.test(source)) {
    findings.push(`${rel}: Field state set without useContractForm — validate through the shared request contract`);
  }
}

if (findings.length === 0) {
  console.log("check-form-contracts: forms stay on the shared contract and primitives.");
  process.exit(0);
}
console.log(`check-form-contracts: ${findings.length} finding(s)`);
for (const finding of findings) console.log(`  ${finding}`);
process.exit(reportOnly ? 0 : 1);
