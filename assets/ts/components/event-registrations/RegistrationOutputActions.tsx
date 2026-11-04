import { Menu } from "../../ui/Menu";
import { DownloadAction } from "../../ui/DownloadAction";
import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";

/** The same explicit output choices for the matching roster and an optional row selection. */
export function RegistrationOutputActions({
  onPrint,
  scope,
  attendeeUrl,
  sponsorUrl,
}: {
  onPrint?: (action: BadgePrintAction) => void;
  scope?: "matching" | "selected";
  attendeeUrl: string | null;
  sponsorUrl: string | null;
}) {
  return (
    <>
      {onPrint && (
        <Menu
          label={`Print ${scope ? `${scope} ` : ""}attendees`}
          align="end"
          items={[
            { id: "labels", label: "Print labels", onSelect: () => onPrint("labels"), disabled: !attendeeUrl },
            {
              id: "label-csv",
              label: "Download label CSV",
              onSelect: () => onPrint("label_csv"),
              disabled: !attendeeUrl,
            },
            { id: "badges", label: "Print badges", onSelect: () => onPrint("badges"), disabled: !attendeeUrl },
          ]}
        >
          Print
        </Menu>
      )}
      <DownloadAction
        label={`Download ${scope ? `${scope} ` : ""}attendee data (CSV)`}
        menuLabel="Attendee data downloads"
        disabled={!attendeeUrl}
        options={[
          { id: "attendees", label: "Attendee data (CSV)", href: attendeeUrl ?? "", disabled: !attendeeUrl },
          {
            id: "sponsors",
            label: "Sponsor attendee data (consenting attendees only)",
            href: sponsorUrl ?? "",
            disabled: !sponsorUrl,
          },
        ]}
      />
    </>
  );
}
