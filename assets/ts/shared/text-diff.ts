/**
 * A word-level comparison of two texts, for showing a reviewer what a
 * proposal changes rather than two columns to read against each other.
 *
 * Words and the whitespace between them are the units, so a rewritten
 * sentence marks the words that moved and leaves the rest alone. Two texts
 * with nothing in common come back as one removal and one insertion.
 */
export type TextDiffSegment = { kind: "same" | "added" | "removed"; text: string };

/**
 * Above this many tokens on a side the quadratic comparison would take the
 * page with it; the change is then stated as a whole replacement.
 */
const TOKEN_BUDGET = 1500;

/**
 * A word carries the whitespace after it, so a marked phrase does not break
 * on every space; words compare without that whitespace, so a re-spaced text
 * is not a rewrite.
 */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function sameWord(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** Collapses runs of one kind so a marked phrase is one span, not one per word. */
function pushSegment(segments: TextDiffSegment[], kind: TextDiffSegment["kind"], text: string): void {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

export function diffWords(before: string, after: string): TextDiffSegment[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > TOKEN_BUDGET * TOKEN_BUDGET) {
    const segments: TextDiffSegment[] = [];
    if (before) segments.push({ kind: "removed", text: before });
    if (after) segments.push({ kind: "added", text: after });
    return segments;
  }
  // Longest common subsequence over tokens; `table[i][j]` is the length of
  // the common subsequence of a[i..] and b[j..].
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = sameWord(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const segments: TextDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (sameWord(a[i], b[j])) {
      // The proposed spacing is what the reader would see after approval.
      pushSegment(segments, "same", b[j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pushSegment(segments, "removed", a[i]);
      i += 1;
    } else {
      pushSegment(segments, "added", b[j]);
      j += 1;
    }
  }
  for (; i < a.length; i += 1) pushSegment(segments, "removed", a[i]);
  for (; j < b.length; j += 1) pushSegment(segments, "added", b[j]);
  return segments;
}
