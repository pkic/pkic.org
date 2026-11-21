/** A word joined by a hyphen, such as "ML-DSA" or "X.509-based". */
const HYPHENATED = /(\S*\w-\w\S*)/;

/**
 * Text set large on a screen in the room or on the stream: a hyphenated name
 * such as "ML-DSA" stays on one line instead of breaking at its hyphen.
 */
export function LiveScreenText({ text }: { text: string }) {
  const parts = text.split(HYPHENATED);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
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
