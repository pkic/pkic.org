/**
 * Keeps a field's markup matching what the field's stylesheet expects.
 *
 * A template can carry every `pk-` class in the design system and still render
 * nothing the system describes, because the parts only work in their nesting:
 *
 *   - `pk-field--ok|--advisory|--invalid` set the `--state-*` variables that
 *     the border, the mark and the message read. They are set on `pk-field`.
 *     A label, message or help text outside one is a part with no whole: it
 *     can never show a state, and the validators have nowhere to put one.
 *   - `pk-field__state` is positioned against `pk-field__control`. An input
 *     that is not inside that wrapper has nowhere to draw its mark.
 *
 * Both faults are invisible in review — the classes look right — and invisible
 * at runtime until someone compares a form against the design page. This is
 * the check that makes them loud.
 *
 * Usage: node scripts/check-field-structure.mjs [--report]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const reportOnly = process.argv.includes("--report");

const roots = ["layouts", "assets/ts"];

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Each part, and the ancestor whose box it is positioned and themed inside.
 *
 * The control wrapper is only required of an input that is already inside a
 * field. A bare `pk-input` elsewhere — a search box in a toolbar, a filter in a
 * table header — is a control, not a field, and has no label, message or state
 * to hold together.
 */
const REQUIRED_ANCESTOR = [
  { part: /^pk-field__(label|message|help|control|required)$/, ancestor: "pk-field" },
  { part: /^pk-input(--\w+)?$/, ancestor: "pk-field__control", onlyInside: "pk-field" },
];

/**
 * Class lists Hugo or JSX builds at render time.
 *
 * The scanner reads a literal attribute; an interpolated one is not something
 * it can resolve, and guessing produces false failures. `check-design-isolation`
 * already refuses interpolated class names on adopted surfaces, so this is a
 * gap there rather than an unguarded hole here.
 */
const DYNAMIC = /\{\{|\$\{|\{/;

function classesOf(attributes) {
  const match = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/.exec(attributes);
  const value = match?.[1] ?? match?.[2];
  if (value === undefined) return { names: [], dynamic: Boolean(match) };
  if (DYNAMIC.test(value)) return { names: value.split(/\s+/).filter((n) => !DYNAMIC.test(n)), dynamic: true };
  return { names: value.split(/\s+/).filter(Boolean), dynamic: false };
}

/** Hugo actions and JSX expressions are removed, keeping the line count. */
function stripActions(source) {
  return source.replace(/\{\{-?[\s\S]*?-?\}\}/g, (match) => match.replace(/[^\n]/g, " "));
}

const failures = [];

function inspect(file) {
  const rel = relative(root, file);
  const source = stripActions(readFileSync(file, "utf8"));
  if (!source.includes("pk-field") && !source.includes("pk-input")) return;

  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  let match;
  while ((match = tag.exec(source)) !== null) {
    const [text, closing, name, attributes, selfClosing] = match;
    const lower = name.toLowerCase();

    if (closing) {
      // Tolerant of a template whose branches open and close across an action:
      // unwind to the match rather than treating the file as unparseable.
      const at = stack.map((frame) => frame.name).lastIndexOf(lower);
      if (at >= 0) stack.length = at;
      continue;
    }

    const { names, dynamic } = classesOf(attributes);
    const line = source.slice(0, match.index).split("\n").length;

    for (const className of names) {
      for (const { part, ancestor, onlyInside } of REQUIRED_ANCESTOR) {
        if (!part.test(className)) continue;
        if (onlyInside && !stack.some((frame) => frame.classes.includes(onlyInside))) continue;
        const inside = names.includes(ancestor) || stack.some((frame) => frame.classes.includes(ancestor));
        // A dynamic ancestor may be the one required, and the scanner cannot
        // tell. Reporting it would train people to ignore the gate.
        if (inside || stack.some((frame) => frame.dynamic)) continue;
        failures.push(`${rel}:${line}  ${className} is not inside a ${ancestor}\n    ${text.trim()}`);
      }
    }

    if (!VOID.has(lower) && !selfClosing) stack.push({ name: lower, classes: names, dynamic });
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (/\.(html|tsx)$/.test(entry)) inspect(full);
  }
}

for (const dir of roots) walk(join(root, dir));

if (failures.length === 0) {
  console.log("Field structure: every part sits inside the element that styles it.");
  process.exit(0);
}

console.error(
  `Field structure: ${failures.length} part${failures.length === 1 ? "" : "s"} outside the element that styles it.\n`,
);
for (const failure of failures) console.error(`  ${failure}\n`);
process.exit(reportOnly ? 0 : 1);
