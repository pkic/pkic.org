import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { PanelBody } from "../../../../../../ui/Panel";
export function ScannerLeadExport({ slug, sponsorId }: { slug: string; sponsorId: string }) {
  return (
    <PanelBody>
      <div class="pk-cluster pk-cluster--nowrap">
        <DownloadAction
          label="Download consenting leads (CSV)"
          href={`/api/v1/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(sponsorId)}/leads.csv`}
          filename={`leads-${slug}.csv`}
        />
        <span>Exports current contact details for this sponsor’s captured leads who still consent to sharing.</span>
      </div>
    </PanelBody>
  );
}
