import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { IconPrint } from "../../../../../../components/icons/app-navigation";
import { ActionTile, ActionTiles } from "../../../../../../ui/ActionTile";
import { IconCalendar } from "../../../../../../ui/MediaIcons";
import { ScannerModeIcon } from "./ScannerModeIcon";

/** The task determines the protocol action; staff do not need to configure a scan mode. */
export function ScannerDestinationTiles({
  allowedActions,
  printHref,
  disabled,
  onVenue,
  onSessions,
}: {
  allowedActions: readonly EventScanRequest["action"][];
  disabled: boolean;
  printHref?: string;
  onVenue: (action: EventScanRequest["action"]) => void;
  onSessions: () => void;
}) {
  const entrance = allowedActions.includes("attendance")
    ? "attendance"
    : allowedActions.includes("admission")
      ? "admission"
      : "check";
  return (
    <div class="pk-scanner-destinations">
      <p>What would you like to do?</p>
      <ActionTiles label="Choose a scanner task">
        {allowedActions.includes(entrance) && (
          <li>
            <ActionTile
              icon={<ScannerModeIcon action={entrance} />}
              label="Venue entrance"
              hint={
                entrance === "attendance"
                  ? "Check people in"
                  : entrance === "admission"
                    ? "Check admission"
                    : "Check registration"
              }
              disabled={disabled}
              onClick={() => onVenue(entrance)}
            />
          </li>
        )}
        {allowedActions.includes("checkout") && (
          <li>
            <ActionTile
              icon={<ScannerModeIcon action="checkout" />}
              label="Venue exit"
              hint="Check people out"
              disabled={disabled}
              onClick={() => onVenue("checkout")}
            />
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
