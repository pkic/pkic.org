import { IconCalendar, IconTools, StrokeIcon } from "../../../ui/MediaIcons";
import { IconHome, IconPerson, IconClipboard, IconDocument } from "../../../components/icons/app-navigation";
import { PkicMark } from "../../../ui/PkicMark";
import { IconOrganization } from "../../../components/icons";

/** Reuse the app navigation glyphs in the expanded menu and its collapsed rail. */
export function PortalNavigationIcon({ section }: { section: string }) {
  switch (section) {
    case "home":
      return <IconHome width="20" height="20" />;
    case "groups":
      return <PkicMark width="20" height="20" highlight="table" />;
    case "events":
      return <IconCalendar width="20" height="20" />;
    case "organizations":
    case "organization":
      return <IconOrganization width="20" height="20" />;
    case "members":
    case "membership":
      return <PkicMark width="20" height="20" highlight="arcs" />;
    case "users":
      return <IconPerson width="20" height="20" />;
    case "application":
      return <IconDocument width="20" height="20" />;
    case "forms":
      return <IconClipboard width="20" height="20" />;
    case "sponsors":
      return (
        <StrokeIcon width="20" height="20">
          <path d="m1 6 3-3 4 1 4-1 3 3-3 6H4zM4 3l3 6 2 1 3-7M2 8l3 3M14 8l-3 3" />
        </StrokeIcon>
      );
    case "settings":
      return <IconTools width="20" height="20" />;
    case "donations":
      return (
        <StrokeIcon width="20" height="20">
          <path d="M8 13.5 2.5 8a3.2 3.2 0 0 1 4.6-4.4l.9.9.9-.9A3.2 3.2 0 0 1 13.5 8z" />
        </StrokeIcon>
      );
    default:
      return <IconDocument width="20" height="20" />;
  }
}
