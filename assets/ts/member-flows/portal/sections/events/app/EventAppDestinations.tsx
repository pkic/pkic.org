/**
 * The event app's destinations as a grid of icon tiles: the More sheet's
 * content, and the More page a deep link opens. Tiles are links with room
 * between them, each comfortably above the 48px touch target.
 */
import { APP_ICONS } from "../../../../../components/icons/app-navigation";
import { ActionTile, ActionTiles } from "../../../../../ui/ActionTile";
import type { EventAppDestination } from "./event-app-tabs";

export function EventAppDestinations({
  destinations,
  label,
  onNavigate,
}: {
  destinations: readonly EventAppDestination[];
  label: string;
  /** Called as a tile is followed, so a sheet can close behind it. */
  onNavigate?: () => void;
}) {
  return (
    <ActionTiles label={label}>
      {destinations.map((destination) => {
        const Icon = APP_ICONS[destination.icon];
        return (
          <li key={destination.id}>
            <ActionTile
              href={destination.href}
              data-event-more={destination.id}
              onClick={onNavigate}
              icon={<Icon width="26" height="26" />}
              label={destination.label}
            />
          </li>
        );
      })}
    </ActionTiles>
  );
}
