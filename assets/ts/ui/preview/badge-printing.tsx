import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";
import { composeBadgePrintSvg } from "../../../shared/badge-print-svg";
import {
  createPqcConferenceBadgeTemplate,
  PQC_CONFERENCE_BADGE_FONT_URLS,
  PQC_CONFERENCE_BADGE_LINKS,
} from "../../../shared/badge-pqc-template";
import { loadBadgeTemplateFonts } from "../../components/event-badges/badge-template-fonts";
import type { BadgePrintingContext } from "../../../shared/schemas/route-contracts-event-badges";
import { BADGE_LABEL_PRINTING_CONTEXT } from "../../../shared/badge-label-policy";
import { BadgePrintPreview } from "../../components/event-badges/BadgePrintPreview";
import { Alert } from "../Alert";
import type { PreviewSection } from "./PreviewShell";

const group = { key: "lead", source: "event" as const, tierName: "Diamond" };
const sampleBranding = {
  ...BADGE_LABEL_PRINTING_CONTEXT,
  branding: [
    {
      ...group,
      sponsors: Array.from({ length: 4 }, (_, index) => ({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name: `Example lead sponsor ${index + 1}`,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 100"><rect width="280" height="100" fill="${["#198754", "#2563a5", "#9747a6", "#b95712"][index]}"/><text x="140" y="65" text-anchor="middle" font-size="44" fill="#fff">LEAD ${index + 1}</text></svg>`,
      })),
    },
  ],
};

function BadgeExample() {
  const [error, setError] = useState("");
  const [svg, setSvg] = useState("");
  const [printing, setPrinting] = useState<BadgePrintingContext>(BADGE_LABEL_PRINTING_CONTEXT);
  useEffect(() => {
    let active = true;
    void Promise.all([
      QRCode.toString("ABCDEFGHJKLMNPQR", { type: "svg", errorCorrectionLevel: "M", margin: 4 }),
      loadBadgeTemplateFonts(PQC_CONFERENCE_BADGE_FONT_URLS),
    ])
      .then(([qr, fonts]) => {
        if (!active) return;
        const template = createPqcConferenceBadgeTemplate({
          title: "Example conference",
          dates: "",
          city: "",
          cityscape: false,
          sponsorGroups: [{ source: group.source, tierName: group.tierName }],
          fonts,
          links: PQC_CONFERENCE_BADGE_LINKS,
        });
        setPrinting({
          ...sampleBranding,
          template,
          branding: [{ ...sampleBranding.branding[0], key: template.sponsorGroups[0].key }],
        });
        setSvg(composeBadgePrintSvg(qr, "ABCDEFGHJKLMNPQR"));
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Could not load the badge preview. Reload to try again.");
      });
    return () => {
      active = false;
    };
  }, []);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!svg) return null;
  return (
    <BadgePrintPreview
      printing={printing}
      initialDesign="event_badge"
      badges={[
        {
          id: "60000000-0000-4000-8000-000000000001",
          displayName: "Synthetic Attendee",
          firstName: "Synthetic",
          lastName: "Attendee",
          jobTitle: "Cryptography Policy Adviser",
          organization: "Example Research Lab",
          badgeRole: "attendee",
          svg,
        },
      ]}
    />
  );
}

export const badgePrintingSection: PreviewSection = {
  id: "badge-printing",
  title: "Attendee badge printing",
  note: "Front and back with four synthetic lead sponsors. Switch the print layout to preview attendee labels.",
  render: () => <BadgeExample />,
};
