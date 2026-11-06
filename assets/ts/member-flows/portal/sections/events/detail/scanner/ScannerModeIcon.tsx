import { IconCalendar } from "../../../../../../ui/MediaIcons";
import { scannerRole, type ScannerRole } from "./scanner-role";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import {
  IconScan,
  IconPrint,
  IconLeadCard,
  IconVenueEntrance,
  IconVenueExit,
} from "../../../../../../components/icons/app-navigation";

/** Keep the chosen task recognizable in both the launcher and active scanner. */
export function ScannerModeIcon({
  action,
  role = scannerRole(action),
}: {
  action: EventScanRequest["action"];
  role?: ScannerRole;
}) {
  if (role === "session") return <IconCalendar />;
  if (role === "print") return <IconPrint />;
  if (action === "checkout") return <IconVenueExit />;
  if (action === "lead") return <IconLeadCard />;
  if (action === "attendance" || action === "admission") return <IconVenueEntrance />;
  return <IconScan />;
}
