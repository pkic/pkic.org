import { StrokeIcon, type SvgProps } from "../../ui/MediaIcons";

export function IconScannerHelp(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.5 5.5a1.5 1.5 0 0 1 3 0c0 1.5-1.5 1.5-1.5 3M8 11h.01" />
    </StrokeIcon>
  );
}
export function IconScannerSound(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M2 6h3l3-3v10l-3-3H2zM10.5 5.5a4 4 0 0 1 0 5M12.5 3.5a7 7 0 0 1 0 9" />
    </StrokeIcon>
  );
}
