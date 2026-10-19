/** Shared symbols for compact status and category indicators. */
import { StrokeIcon } from "./index";

export { IconPeople } from "./app-navigation";
export { IconClock, IconFlag, IconRemote, IconTools } from "../../ui/MediaIcons";

export function IconSend() {
  return (
    <StrokeIcon>
      <path d="m2 2 12 6-12 6 2-6-2-6Zm2 6h10" />
    </StrokeIcon>
  );
}

export function IconBan() {
  return (
    <StrokeIcon>
      <circle cx="8" cy="8" r="6" />
      <path d="m4 4 8 8" />
    </StrokeIcon>
  );
}

export function IconArchive() {
  return (
    <StrokeIcon>
      <path d="M2 2h12v3H2zM3 5v9h10V5M6 8h4" />
    </StrokeIcon>
  );
}

export function IconMicrophone() {
  return (
    <StrokeIcon>
      <rect x="6" y="1" width="4" height="9" rx="2" />
      <path d="M4 7v1a4 4 0 0 0 8 0V7M8 12v3M5 15h6" />
    </StrokeIcon>
  );
}
