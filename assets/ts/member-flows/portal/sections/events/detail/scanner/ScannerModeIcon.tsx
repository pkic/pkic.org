import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import {
  IconScan,
  IconLeadCard,
  IconVenueEntrance,
  IconVenueExit,
} from "../../../../../../components/icons/app-navigation";

/** Keep the chosen task recognizable in both the launcher and active scanner. */
export function ScannerModeIcon({ action }: { action: EventScanRequest["action"] }) {
  if (action === "checkout") return <IconVenueExit />;
  if (action === "lead") return <IconLeadCard />;
  if (action === "attendance" || action === "admission") return <IconVenueEntrance />;
  return <IconScan />;
}
