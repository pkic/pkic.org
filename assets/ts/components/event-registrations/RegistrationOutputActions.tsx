import { Menu, type MenuItem } from "../../ui/Menu";
import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";

type OutputOptions = {
  onPrint?: (action: BadgePrintAction) => void;
  scope?: "matching" | "selected";
  attendeeUrl: string | null;
  /** Undefined means unsupported; null keeps a supported export disabled for an invalid scope. */
  sponsorUrl?: string | null;
};

/** Shared output hierarchy for the roster, selected rows, and component examples. */
export function registrationOutputMenuItems({ onPrint, attendeeUrl, sponsorUrl }: OutputOptions): MenuItem[] {
  const output = (id: BadgePrintAction, label: string): MenuItem => ({
    id,
    label,
    disabled: !onPrint || !attendeeUrl,
    onSelect: () => onPrint?.(id),
  });
  return [
    ...(onPrint
      ? [{ id: "print", label: "Print", children: [output("labels", "Labels"), output("badges", "Badges")] }]
      : []),
    {
      id: "download",
      label: "Download",
      children: [
        {
          id: "csv",
          label: "CSV",
          children: [
            ...(onPrint ? [output("label_csv", "Labels")] : []),
            { id: "attendee-csv", label: "Attendees", href: attendeeUrl ?? "", disabled: !attendeeUrl },
            ...(sponsorUrl !== undefined
              ? [{ id: "consent-csv", label: "Attendees with consent", href: sponsorUrl ?? "", disabled: !sponsorUrl }]
              : []),
          ],
        },
        ...(onPrint
          ? [{ id: "pdf", label: "PDF", children: [output("badge_pdf", "Badges"), output("label_pdf", "Labels")] }]
          : []),
      ],
    },
  ];
}

export function RegistrationOutputActions(props: OutputOptions) {
  return (
    <Menu
      label={`Actions for ${props.scope ?? "matching"} attendees`}
      align="end"
      items={registrationOutputMenuItems(props)}
    />
  );
}
