import { useMemo, useState } from "preact/hooks";
import { useData } from "../../hooks/useData";
import { getJson } from "../../shared/api-client";
import { badgePrintingResponseSchema } from "../../../shared/schemas/route-contracts-event-badges";
import { BADGE_LABEL_PRINTING_CONTEXT } from "../../../shared/badge-label-policy";
import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";
import { BadgePrintPreview } from "./BadgePrintPreview";
import { BadgeFace } from "./BadgeFace";
import type { PrintableBadgePrint } from "./badge-print-artifacts";
import { SectionHeading } from "../../ui/SectionHeading";
import { Button } from "../../ui/Button";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import "./BadgeArtworkOverview.css";

/** Actual attendee artwork, with print actions beside the faces rather than another preview page. */
export function BadgeArtworkOverview({
  slug,
  badge,
  beforeRelease,
}: {
  slug: string;
  badge: PrintableBadgePrint;
  beforeRelease: () => Promise<boolean>;
}) {
  const badges = useMemo(() => [badge], [badge]);
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges/printing`;
  const printing = useData(() => getJson(endpoint, badgePrintingResponseSchema), [endpoint]);
  const [output, setOutput] = useState<{ action: BadgePrintAction; id: string } | null>(null);
  const print = (action: BadgePrintAction) => setOutput({ action, id: crypto.randomUUID() });
  return (
    <div class="pk-stack">
      <div class="pk-cluster">
        <Button onClick={() => print("badges")} disabled={!printing.data?.template}>
          Print badge
        </Button>
        <Button onClick={() => print("labels")}>Print label</Button>
        <Button onClick={() => print("label_csv")}>Download label CSV</Button>
      </div>
      {printing.loading && <Spinner label="Loading badge artwork…" />}
      {printing.error && <ErrorAlert error={printing.error} />}
      <div class="pk-badge-artwork">
        {printing.data?.template ? (
          <>
            <section class="pk-stack pk-stack--tight">
              <SectionHeading level={3}>Front</SectionHeading>
              <BadgeFace title="Badge front" badge={badge} printing={printing.data} />
            </section>
            <section class="pk-stack pk-stack--tight">
              <SectionHeading level={3}>Back</SectionHeading>
              <BadgeFace title="Badge back" side="back" badge={badge} printing={printing.data} />
            </section>
          </>
        ) : (
          !printing.loading && !printing.error && <p>No badge artwork is configured for this event.</p>
        )}
        <section class="pk-stack pk-stack--tight">
          <SectionHeading level={3}>Label</SectionHeading>
          <BadgeFace title="Attendee label" badge={badge} printing={BADGE_LABEL_PRINTING_CONTEXT} />
        </section>
      </div>
      {output && (
        <BadgePrintPreview
          key={output.id}
          badges={badges}
          action={output.action}
          printing={BADGE_LABEL_PRINTING_CONTEXT}
          beforeRelease={beforeRelease}
          loadPrintingContext={() => getJson(endpoint, badgePrintingResponseSchema)}
        />
      )}
    </div>
  );
}
