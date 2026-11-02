import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";
import { composeBadgePrintSvg } from "../../../shared/badge-print-svg";
import { BADGE_LABEL_PRINTING_CONTEXT } from "../../../shared/badge-label-policy";
import { BadgePrintPreview } from "../../components/event-badges/BadgePrintPreview";
import type { PreviewSection } from "./PreviewShell";

function LabelExample() {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toString("ABCDEFGHJKLMNPQR", { type: "svg", errorCorrectionLevel: "M", margin: 4 }).then((qr) => {
      if (active) setSvg(composeBadgePrintSvg(qr, "ABCDEFGHJKLMNPQR"));
    });
    return () => {
      active = false;
    };
  }, []);
  if (!svg) return null;
  return (
    <BadgePrintPreview
      printing={BADGE_LABEL_PRINTING_CONTEXT}
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
  title: "Attendee label printing",
  note: "Actual-size Brother DK-1208 labels for the front and back of preprinted badges. Synthetic attendee and code.",
  render: () => <LabelExample />,
};
