/**
 * One source for a vocabulary, on both sides of the wire.
 *
 * Issue #24 reported that the portal offered no way to add member types H5,
 * H6 and H7 although `/api/v1/members` accepted them. The cause is a shape,
 * not a typo: a `<Select>` spells its choices out as `<option>` literals while
 * the route parses a shared Zod vocabulary, and the two drift the moment the
 * vocabulary grows. Nothing catches it, because a missing option is not a type
 * error and a form that never offers a value never fails validation.
 *
 * This gate reads the source. For every select in `assets/ts/` whose options
 * are written out as literals, it asks whether some vocabulary in
 * `assets/shared/` already contains exactly those values — and refuses if one
 * does. The fix is always the same: import the vocabulary and map it, the way
 * `EmailOutbox`, `UserProfileEditor` and `MembershipCategoryPicker` already do.
 *
 * What it deliberately does not flag:
 *  - a select that maps a vocabulary and adds an `""` sentinel for "no filter"
 *    — the sentinel is the control's own, not part of the vocabulary;
 *  - a yes/no filter, because `"true"`/`"false"` is a boolean rather than a
 *    vocabulary that can grow;
 *  - a single-option select, which carries no set to compare.
 */
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTypeScriptFiles, readTypeScriptSource, REPOSITORY_ROOT, sourceLine } from "./helpers/source-files";

const SHARED_ROOT = join(REPOSITORY_ROOT, "assets/shared");
const FRONTEND_ROOT = join(REPOSITORY_ROOT, "assets/ts");

/** A named set of string literals a contract accepts. */
interface Vocabulary {
  name: string;
  origin: string;
  values: Set<string>;
}

interface LiteralOptionSet {
  origin: string;
  values: string[];
}

const STRING_LITERAL = /"([^"\\]*)"|'([^'\\]*)'/g;
/** `z.enum([...])`, whether it is named or written inline in an object. */
const ENUM_LITERAL_LIST = /(?:(?:export\s+)?const\s+([A-Za-z0-9_]+)[^=\n]*=\s*)?z\.enum\(\s*\[([^\]]*)\]/g;
/** `const NAME = [...] as const`, the other way a vocabulary is declared. */
const CONST_LITERAL_LIST = /(?:export\s+)?const\s+([A-Za-z0-9_]+)[^=\n]*=\s*\[([^\]]*)\]\s*as const/g;
/** A `<Select>`/`<select>` element and everything it encloses. */
const SELECT_ELEMENT = /<(Select|select)(\s[^>]*)?>(.*?)<\/\1>/gs;
const OPTION_LITERAL = /<option\s[^>]*value=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\})/g;
/** The other way a frontend spells a choice list: an array of `{ value, label }`. */
const OPTION_OBJECT_VALUE = /\bvalue:\s*"([^"]*)"/g;

/** A boolean is not a vocabulary: it cannot gain a third value. */
const BOOLEAN_VALUES = new Set(["true", "false"]);

function literalsIn(list: string): string[] | null {
  const values: string[] = [];
  let consumed = "";
  for (const match of list.matchAll(STRING_LITERAL)) {
    values.push(match[1] ?? match[2] ?? "");
    consumed += match[0];
  }
  // Anything left over is an identifier or a spread, so the list is not a
  // plain set of literals and cannot be compared value by value.
  const remainder = list.replace(STRING_LITERAL, "").replace(/[\s,]/g, "");
  return remainder.length === 0 && consumed.length > 0 ? values : null;
}

function sharedVocabularies(): Vocabulary[] {
  const vocabularies: Vocabulary[] = [];
  for (const path of listTypeScriptFiles(SHARED_ROOT)) {
    const source = readTypeScriptSource(path);
    const origin = relative(REPOSITORY_ROOT, path);
    for (const pattern of [ENUM_LITERAL_LIST, CONST_LITERAL_LIST]) {
      for (const match of source.matchAll(pattern)) {
        const values = literalsIn(match[2]);
        if (!values || values.length < 2) continue;
        const unique = new Set(values);
        if (unique.size !== values.length) continue;
        vocabularies.push({
          name: match[1] ?? `the vocabulary at ${origin}:${sourceLine(source, match.index)}`,
          origin,
          values: unique,
        });
      }
    }
  }
  return vocabularies;
}

/** Options written as JSX, one `<option>` per choice. */
function spelledOutSelects(source: string, origin: string): LiteralOptionSet[] {
  const sets: LiteralOptionSet[] = [];
  for (const element of source.matchAll(SELECT_ELEMENT)) {
    const body = element[3];
    // A select that maps something already derives its list; whatever
    // literals sit beside the mapped ones are the control's own sentinels.
    if (body.includes(".map(")) continue;
    const values = [...body.matchAll(OPTION_LITERAL)]
      .map((option) => option[1] ?? option[2] ?? "")
      .filter((value) => value !== "");
    if (values.length < 2) continue;
    sets.push({ origin: `${origin}:${sourceLine(source, element.index)}`, values });
  }
  return sets;
}

/**
 * Options written as data: an array of `{ value, label }` handed to a picker,
 * a filter, or a radio group. The innermost arrays only, so a list of lists is
 * counted once, at the level where the choices actually are.
 */
function spelledOutOptionArrays(source: string, origin: string): LiteralOptionSet[] {
  const sets: LiteralOptionSet[] = [];
  for (let start = source.indexOf("["); start >= 0; start = source.indexOf("[", start + 1)) {
    const end = source.indexOf("]", start + 1);
    if (end < 0) break;
    const body = source.slice(start + 1, end);
    if (body.includes("[") || body.includes(".map(") || body.includes("...")) continue;
    const values = [...body.matchAll(OPTION_OBJECT_VALUE)].map((option) => option[1]).filter((value) => value !== "");
    if (values.length < 2) continue;
    sets.push({ origin: `${origin}:${sourceLine(source, start)}`, values });
  }
  return sets;
}

function literalOptionSets(): LiteralOptionSet[] {
  return listTypeScriptFiles(FRONTEND_ROOT, [".ts", ".tsx"]).flatMap((path) => {
    const source = readTypeScriptSource(path);
    const origin = relative(REPOSITORY_ROOT, path);
    return [...spelledOutSelects(source, origin), ...spelledOutOptionArrays(source, origin)];
  });
}

function restatedVocabularies(): string[] {
  const vocabularies = sharedVocabularies();
  return literalOptionSets().flatMap(({ origin, values }) => {
    const offered = new Set(values);
    if (offered.size === BOOLEAN_VALUES.size && [...offered].every((value) => BOOLEAN_VALUES.has(value))) return [];
    const match = vocabularies
      .filter((vocabulary) => [...offered].every((value) => vocabulary.values.has(value)))
      .sort((left, right) => left.values.size - right.values.size)[0];
    if (!match) return [];
    const missing = [...match.values].filter((value) => !offered.has(value));
    const gap = missing.length > 0 ? `, omitting ${missing.join(", ")}` : "";
    return [`${origin} spells out ${values.join(", ")} — ${match.name} in ${match.origin} owns it${gap}`];
  });
}

describe("UI vocabularies", () => {
  it("offers exactly what the shared contract accepts, by deriving it", () => {
    expect(restatedVocabularies()).toEqual([]);
  });

  it("recognizes a select that maps its vocabulary rather than restating it", () => {
    // The gate is only useful if it can tell the two apart, and this is the
    // shape every fix takes.
    expect(literalOptionSets().every((set) => set.values.length >= 2)).toBe(true);
    expect(sharedVocabularies().some((vocabulary) => vocabulary.name === "MEMBERSHIP_CATEGORIES")).toBe(true);
  });
});
