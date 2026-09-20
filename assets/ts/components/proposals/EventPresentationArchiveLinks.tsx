import { ButtonLink } from "../../ui/Button";

/** Download controls shared by every event proposal catalogue. */
export function EventPresentationArchiveLinks({ slug, canRead }: { slug: string; canRead: boolean }) {
  if (!canRead) return null;
  const archivePath = `/api/v1/events/${encodeURIComponent(slug)}/presentations/archive`;
  return (
    <div class="pk-cluster" role="group" aria-label="Download event presentations">
      <ButtonLink size="sm" href={archivePath} title="Download the current presentation for every accepted proposal">
        <span aria-hidden="true">↓</span> Current presentations
      </ButtonLink>
      <ButtonLink
        size="sm"
        href={`${archivePath}?versions=all`}
        title="Download every retained presentation version for accepted proposals"
      >
        All presentation versions
      </ButtonLink>
    </div>
  );
}
