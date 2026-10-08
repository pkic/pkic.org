import type { ComponentChildren, JSX } from "preact";

type SvgProps = Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">;

export function StrokeIcon({ children, ...props }: SvgProps & { children: ComponentChildren }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconVideo(props: SvgProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="m6 5 5 3-5 3z" />
    </StrokeIcon>
  );
}

export function IconRemote() {
  return (
    <StrokeIcon>
      <rect x="2" y="2" width="12" height="9" rx="1" />
      <path d="M8 11v3M5 14h6" />
    </StrokeIcon>
  );
}

export function IconDownload(props: SvgProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 1.5v9m-3-3 3 3 3-3M2 10.5v3h12v-3" />
    </svg>
  );
}
