import { scannerActionLabel, scannerEntranceAction } from "./ScannerModeSelect";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { IconPrint } from "../../../../../../components/icons/app-navigation";
import { ActionTile, ActionTiles, type ActionTileProps } from "../../../../../../ui/ActionTile";
import { IconCalendar } from "../../../../../../ui/MediaIcons";
import { ScannerModeIcon } from "./ScannerModeIcon";
import "./EventScanner.css";

type ScannerTaskTileProps = Pick<ActionTileProps, "href" | "onClick" | "disabled"> & {
  action: EventScanRequest["action"];
  purpose?: "scan" | "collection";
  occurrenceId?: string | null;
  targetLabel?: string;
  roomLabel?: string;
  eventLabel?: string;
};

/** One presentation for the same scanner task online and on the offline entry screen. */
export function ScannerTaskTile({
  action,
  purpose,
  occurrenceId,
  targetLabel,
  roomLabel,
  eventLabel,
  ...tile
}: ScannerTaskTileProps) {
  let label: string;
  let hint: string;
  if (action === "lead") {
    label = "Lead scanner";
    hint = targetLabel ?? "";
  } else if (purpose === "collection") {
    label = "Badge collection";
    hint = "";
  } else if (occurrenceId) {
    label = targetLabel ?? "Session scanner";
    hint = [roomLabel, scannerActionLabel(action)].filter(Boolean).join(" · ");
  } else {
    label = scannerActionLabel(action);
    hint = "";
  }
  return (
    <ActionTile
      icon={<ScannerModeIcon action={action} role={occurrenceId ? "session" : undefined} />}
      label={label}
      hint={[hint, eventLabel].filter(Boolean).join(" · ")}
      data-scanner-action={action}
      data-scanner-purpose={purpose ?? "scan"}
      {...tile}
    />
  );
}

/** The task determines the protocol action; staff do not need to configure a scan mode. */
export function ScannerDestinationTiles({
  allowedActions,
  printHref,
  disabled,
  onVenue,
  onSessions,
  onCollection,
}: {
  allowedActions: readonly EventScanRequest["action"][];
  disabled: boolean;
  printHref?: string;
  onVenue: (action: EventScanRequest["action"]) => void;
  onSessions: () => void;
  onCollection?: () => void;
}) {
  const entrance = scannerEntranceAction(allowedActions);
  return (
    <div class="pk-scanner-destinations">
      <p>What would you like to do?</p>
      <ActionTiles label="Choose a scanner task">
        {onCollection && allowedActions.includes("attendance") && (
          <li>
            <ScannerTaskTile action="attendance" purpose="collection" disabled={disabled} onClick={onCollection} />
          </li>
        )}
        {allowedActions.includes(entrance) && (
          <li>
            <ScannerTaskTile action={entrance} disabled={disabled} onClick={() => onVenue(entrance)} />
          </li>
        )}
        {allowedActions.includes("checkout") && (
          <li>
            <ScannerTaskTile action="checkout" disabled={disabled} onClick={() => onVenue("checkout")} />
          </li>
        )}
        <li>
          <ActionTile
            icon={<IconCalendar />}
            label="Sessions"
            hint="Choose a room"
            disabled={disabled}
            onClick={onSessions}
          />
        </li>
        {printHref && (
          <li>
            <ActionTile icon={<IconPrint />} label="Print" hint="Print labels or badges" href={printHref} />
          </li>
        )}
      </ActionTiles>
    </div>
  );
}
