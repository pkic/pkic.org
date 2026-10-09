/**
 * The event app's destinations as a grid of icon tiles: the More sheet's
 * content, and the More page a deep link opens. Tiles are links with room
 * between them, each comfortably above the 48px touch target.
 */
import { APP_ICONS } from "../../../../../components/icons/app-navigation";
import type { EventAppDestination } from "./event-app-tabs";
import "./EventApp.css";

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
    <ul class="pk-event-destinations" aria-label={label}>
      {destinations.map((destination) => {
        const Icon = APP_ICONS[destination.icon];
        return (
          <li key={destination.id} class="pk-event-destinations__item">
            <a
              class="pk-event-destinations__tile"
              href={destination.href}
              data-event-more={destination.id}
              onClick={onNavigate}
            >
              <Icon class="pk-event-destinations__icon" width="26" height="26" />
              <span>{destination.label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
