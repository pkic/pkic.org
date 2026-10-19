import socialIcons from "../../shared/social-icons.json";
import { getLinkMark } from "../../shared/schemas/links";
import { IconExternalLink } from "./MediaIcons";

/**
 * The mark a profile link wears: the network's own glyph when the URL is one
 * we recognize, a plain external-link icon otherwise. Decorative; the link's
 * label names it.
 */
export function LinkMark({ url, class: className }: { url: string; class?: string }) {
  const paths = socialIcons[getLinkMark(url) as keyof typeof socialIcons];
  if (!paths) return <IconExternalLink class={className} />;
  return (
    // A network's own mark stays the solid brand glyph it publishes.
    <svg
      class={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Whether a URL has a network's own mark, rather than the generic one. */
export function hasNetworkMark(url: string): boolean {
  return getLinkMark(url) in socialIcons;
}
