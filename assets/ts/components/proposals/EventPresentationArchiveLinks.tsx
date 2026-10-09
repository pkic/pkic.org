import { DownloadAction } from "../../ui/DownloadAction";

/** Download controls shared by every event proposal catalogue. */
export function EventPresentationArchiveLinks({
  slug,
  canRead,
  selectedProposalIds,
}: {
  slug: string;
  canRead: boolean;
  selectedProposalIds: ReadonlySet<string>;
}) {
  if (!canRead) return null;
  const archivePath = `/api/v1/events/${encodeURIComponent(slug)}/presentations/archive`;
  const selection = selectedProposalIds.size
    ? `proposalIds=${encodeURIComponent([...selectedProposalIds].sort().join(","))}`
    : "";
  const currentHref = selection ? `${archivePath}?${selection}` : archivePath;
  const allHref = `${archivePath}?${["versions=all", selection].filter(Boolean).join("&")}`;
  return (
    <div class="pk-cluster" role="group" aria-label="Download event presentations">
      <DownloadAction
        label={
          selectedProposalIds.size
            ? "Download current presentations for selected proposals"
            : "Download current presentations for all accepted proposals"
        }
        menuLabel="Presentation download options"
        options={[
          { id: "current", label: "Current presentations", href: currentHref },
          { id: "all", label: "All presentation versions", href: allHref },
        ]}
      />
    </div>
  );
}
