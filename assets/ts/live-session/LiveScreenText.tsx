/** A word joined by a hyphen, such as "ML-DSA" or "X.509-based". */
const HYPHENATED = /(\S*\w-\w\S*)/;
/** Longer runs, such as a draft name or a link, may break, or the screen's box would cut them off. */
const UNBROKEN_MAX_LENGTH = 20;

/**
 * Text set large on a screen in the room or on the stream: a hyphenated name
 * such as "ML-DSA" stays on one line instead of breaking at its hyphen, as
 * long as it is short enough to fit one.
 */
export function LiveScreenText({ text }: { text: string }) {
  const parts = text.split(HYPHENATED);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 && part.length <= UNBROKEN_MAX_LENGTH ? (
          <span key={index} class="pk-nowrap">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
