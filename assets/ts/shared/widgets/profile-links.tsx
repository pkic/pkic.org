import { createRef, render } from "preact";
import { ProfileLinksInput, type ProfileLinksHandle } from "../../components/ProfileLinksInput";

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
