/**
 * What a detail page shows when the record behind its URL does not exist.
 *
 * It is the whole page, so it carries its own `.pk` root, and it replaces a
 * loading state rather than arriving with the document — `role="status"` is
 * what tells a reader who is not watching that the wait ended in nothing.
 *
 * The back link stays inside a paragraph so the link box is the width of its
 * own text: in the vertical rhythm the panel used to get from `py-5`, a bare
 * anchor would stretch the full column and take clicks far from the words.
 */
export function NotFoundPanel({
  message,
  backHref,
  backLabel,
}: {
  message: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div class="pk pk-container pk-section pk-center" role="status">
      <p class="pk-lede">{message}</p>
      <p>
        <a href={backHref}>&larr; {backLabel}</a>
      </p>
    </div>
  );
}
