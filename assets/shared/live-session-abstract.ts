import { cutAtWord } from "./live-stage-display";
import { LIVE_ROOM_POLICY } from "./live-session-policy";
import { plainText } from "./markdown-plain-text";

/** Markdown that has no place in one line of plain text: headings and rules go, list and quote marks leave their text. */
const MARKDOWN_BLOCKS: readonly [RegExp, string][] = [
  [/^\s{0,3}#{1,6}\s.*$/gmu, ""],
  [/^\s{0,3}(?:[-*_]\s*){3,}$/gmu, ""],
  [/^\s{0,3}(?:>\s?)+/gmu, ""],
  [/^\s*(?:[-*+]|\d{1,9}[.)])\s+/gmu, ""],
  [/<[^>\n]+>/gu, " "],
];

/**
 * A session's abstract as the session graphic shows it: its description as
 * plain text, cut at a word to what a board holds. A board does not render
 * Markdown, so headings and rules drop out, lists and quotes keep their text,
 * links keep their words, and paragraphs run on as one. Null when the session
 * has no description.
 */
export function liveSessionAbstract(description: string | undefined): string | null {
  const text = plainText(
    MARKDOWN_BLOCKS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), description ?? ""),
  );
  // The cut adds an ellipsis, so it leaves a character for it.
  return text ? cutAtWord(text, LIVE_ROOM_POLICY.sessionAbstractMaxLength - 1) : null;
}
