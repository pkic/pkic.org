import { ConsentList } from "../../components/ConsentCard";
import type { PreviewSection } from "./PreviewShell";

export const consentAgreementsSection: PreviewSection = {
  id: "consent-agreements",
  title: "Saved agreements",
  note: "Saved required and optional agreements stay checked; a new optional term remains an editable choice.",
  render: () => (
    <ConsentList
      lockRecorded
      terms={[
        {
          termKey: "privacy",
          version: "1",
          required: true,
          contentRef: null,
          displayText: "I agree to the event privacy policy.",
        },
        {
          termKey: "newsletter",
          version: "1",
          required: false,
          contentRef: null,
          displayText: "I agree to receive event news.",
        },
        {
          termKey: "recording",
          version: "2",
          required: false,
          contentRef: null,
          displayText: "I agree to the recording terms.",
        },
      ]}
      recorded={[
        { termKey: "privacy", version: "1" },
        { termKey: "newsletter", version: "1" },
      ]}
    />
  ),
};
