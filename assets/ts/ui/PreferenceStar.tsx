import { StrokeIcon } from "./MediaIcons";

/** A saved session preference, independent of place registration. */
export function PreferenceStar({ selected = false }: { selected?: boolean }) {
  return (
    <StrokeIcon>
      <path
        d="m8 1.5 2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.9l-4 2.1.8-4.5-3.3-3.2 4.5-.7z"
        fill={selected ? "currentColor" : "none"}
      />
    </StrokeIcon>
  );
}
