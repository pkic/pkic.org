import { STAR_PATH, StrokeIcon } from "./MediaIcons";

/** A saved session preference, independent of place registration. */
export function PreferenceStar({ selected = false }: { selected?: boolean }) {
  return (
    <StrokeIcon>
      <path d={STAR_PATH} fill={selected ? "currentColor" : "none"} />
    </StrokeIcon>
  );
}
