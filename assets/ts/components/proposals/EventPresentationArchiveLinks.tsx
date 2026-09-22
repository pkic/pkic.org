import { IconDownload } from "../icons";
import { ButtonLink } from "../../ui/Button";

/** Download controls shared by every event proposal catalogue. */
export function EventPresentationArchiveLinks({ slug, canRead }: { slug: string; canRead: boolean }) {
  if (!canRead) return null;
  const archivePath = `/api/v1/events/${encodeURIComponent(slug)}/presentations/archive`;
  return (
    <div class="pk-cluster" role="group" aria-label="Download event presentations">
      <ButtonLink href={archivePath} title="Download the current presentation for every accepted proposal">
        <IconDownload /> Current presentations
      </ButtonLink>
      <ButtonLink
        href={`${archivePath}?versions=all`}
        title="Download every retained presentation version for accepted proposals"
      >
        <IconDownload /> All presentation versions
      </ButtonLink>
    </div>
  );
}
