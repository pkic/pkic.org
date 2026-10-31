import type { ComponentType, JSX } from "preact";
import { IconMapPin, IconVirtual, IconOnDemand, IconCalendarCheck, IconRemove } from "./icons";
import {
  IconPeople,
  IconRoundtable,
  IconVideoLocation,
  IconVideoPeople,
  IconCocktail,
  IconCoffee,
  IconDining,
} from "../ui/MediaIcons";
import { attendanceIconName, type AttendanceIconName } from "../../shared/event-attendance-icons";

type AttendanceIconComponent = ComponentType<Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">>;

const OPTION_ICONS: Record<Exclude<AttendanceIconName, "none">, AttendanceIconComponent> = {
  location: IconMapPin,
  video: IconVirtual,
  video_location: IconVideoLocation,
  video_people: IconVideoPeople,
  play: IconOnDemand,
  calendar: IconCalendarCheck,
  people: IconPeople,
  roundtable: IconRoundtable,
  cocktail: IconCocktail,
  coffee: IconCoffee,
  dining: IconDining,
};

function iconFor(type: string | null, configured?: AttendanceIconName): AttendanceIconComponent | null {
  if (type === null || type === "") return IconRemove;
  const name = attendanceIconName(type, configured);
  return name === "none" ? null : OPTION_ICONS[name];
}

/** The icon a way of attending is shown with, wherever attendance is shown. */
export function AttendanceIcon({ type, icon }: { type: string | null; icon?: AttendanceIconName }) {
  const Icon = iconFor(type, icon);
  return Icon ? <Icon width="18" height="18" aria-hidden="true" /> : null;
}
