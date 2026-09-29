/**
 * A text and what a proposal changes in it, in one reading.
 *
 * The reviewer used to get the current and the proposed text as two columns
 * to compare by eye; here removed words are struck through and inserted ones
 * marked, so a one-word edit in a paragraph is found at a glance (#97).
 * `<del>` and `<ins>` carry the meaning for assistive technology, and each
 * mark also names itself for a reader whose screen reader skips them.
 */
import { diffWords } from "../shared/text-diff";
import "./TextDiff.css";

export function TextDiff({ before, after, label }: { before: string; after: string; label?: string }) {
  const segments = diffWords(before, after);
  if (segments.length === 0) return <em class="pk-muted">(empty)</em>;
  return (
    <p class="pk-diff" aria-label={label}>
      {segments.map((segment, index) =>
        segment.kind === "same" ? (
          <span key={index}>{segment.text}</span>
        ) : segment.kind === "removed" ? (
          <del key={index} class="pk-diff__removed">
            {segment.text}
          </del>
        ) : (
          <ins key={index} class="pk-diff__added">
            {segment.text}
          </ins>
        ),
      )}
    </p>
  );
}
