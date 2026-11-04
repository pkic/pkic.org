import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { ActionTile, ActionTiles } from "../../../../../../ui/ActionTile";
import { IconCalendar } from "../../../../../../ui/MediaIcons";
import { StrokeIcon } from "../../../../../../ui/MediaIcons";

function EntranceIcon({ exit = false }: { exit?: boolean }) {
  return (
    <StrokeIcon>
      <path d="M9 2h4v12H9M2 8h8" />
      <path d={exit ? "m5 5-3 3 3 3" : "m7 5 3 3-3 3"} />
    </StrokeIcon>
  );
}

/** The task determines the protocol action; staff do not need to configure a scan mode. */
export function ScannerDestinationTiles({
  allowedActions,
  disabled,
  onVenue,
  onSessions,
}: {
  allowedActions: readonly EventScanRequest["action"][];
  disabled: boolean;
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
      <p>Where are you scanning?</p>
      <ActionTiles label="Choose where to scan">
        {allowedActions.includes(entrance) && (
          <li>
            <ActionTile
              icon={<EntranceIcon />}
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
              icon={<EntranceIcon exit />}
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
      </ActionTiles>
    </div>
  );
}
