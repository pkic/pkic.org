/** Shared symbols for compact status and category indicators. */
import { StrokeIcon } from "./index";

export function IconSend() {
  return (
    <StrokeIcon>
      <path d="m2 2 12 6-12 6 2-6-2-6Zm2 6h10" />
    </StrokeIcon>
  );
}

export function IconClock() {
  return (
    <StrokeIcon>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l3 2" />
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

export function IconFlag() {
  return (
    <StrokeIcon>
      <path d="M3 14V2h10l-2 3 2 3H3" />
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

export function IconPeople() {
  return (
    <StrokeIcon>
      <circle cx="6" cy="5" r="2" />
      <path d="M2 14v-2a4 4 0 0 1 8 0v2M11 3a2 2 0 0 1 0 4M12 10a3 3 0 0 1 2 3v1" />
    </StrokeIcon>
  );
}

export function IconTools() {
  return (
    <StrokeIcon>
      <path d="m2 2 3 1 8 10-2 1L3 4 2 2ZM10 2a3 3 0 0 0-2 4l-6 6 2 2 6-6a3 3 0 0 0 4-3l-2 2-3-3 2-2Z" />
    </StrokeIcon>
  );
}
