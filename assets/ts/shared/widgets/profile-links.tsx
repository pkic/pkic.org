import { createRef, render } from "preact";
import { ProfileLinksInput, type ProfileLinksHandle } from "../../components/ProfileLinksInput";

/**
 * Canonical, object-tolerant normalizer for populating a `ProfileLinksInput`/
 * `renderProfileLinks` widget from API response data. Every links-editing
 * page (admin user editor, admin proposal-speaker editor, and the two
 * token-authenticated proposal/speaker manage pages) needs this: even though
 * the backend now always emits `links` as `string[]` (P10-01), some admin
 * response types still declare the older, more defensive
 * `Array<string | { label?, url? }>` shape, and any caller should degrade
 * gracefully rather than throw on a non-array or malformed entry. Accepting
 * `unknown` keeps this the single normalizer for every caller regardless of
 * how precisely each one's local response type is declared — a `string[]`
 * argument normalizes through it identically to a plain trim+filter.
 *
 * Does not cap array length: `ProfileLinksInput.setLinks`/`getLinks` already
 * enforce the widget's own `max`, so a second, possibly-inconsistent cap here
 * would be redundant duplicated policy.
 */
export function normalizeProfileLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "url" in entry && typeof entry.url === "string") return entry.url;
      return "";
    })
    .map((url) => url.trim())
    .filter(Boolean);
}

export interface ProfileLinksWidget {
  getLinks(): string[];
  setLinks(urls: string[]): void;
  el: HTMLElement;
}

export function renderProfileLinks(
  container: HTMLElement,
  fieldName: string,
  options: { max?: number } = {},
): ProfileLinksWidget {
  const ref = createRef<ProfileLinksHandle>();
  render(<ProfileLinksInput ref={ref} fieldName={fieldName} max={options.max} />, container);
  return {
    el: container,
    getLinks: () => ref.current?.getLinks() ?? [],
    setLinks: (urls: string[]) => ref.current?.setLinks(urls),
  };
}
