import { ButtonLink } from "../../../../../../ui/Button";
import { PanelBody } from "../../../../../../ui/Panel";
export function ScannerLeadExport({ slug, sponsorId }: { slug: string; sponsorId: string }) {
  return (
    <PanelBody>
      <ButtonLink
        href={`/api/v1/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(sponsorId)}/leads.csv`}
        download={`leads-${slug}.csv`}
      >
        Download consenting leads
      </ButtonLink>
      <p>Exports current contact details for this sponsor’s captured leads who still consent to sharing.</p>
    </PanelBody>
  );
}
