/**
 * HeadingOutline — where a surface's heading outline starts in the document.
 *
 * The shared heading primitives are authored against one convention: a
 * screen's title is level 2, its sections are level 3, and a section inside a
 * section is level 4. That convention is relative. The surface hosting the
 * screen decides which document level its title takes:
 *
 * - The portal shell starts it at 1, so every portal screen's title is the
 *   document's one `<h1>` and its sections step down from there.
 * - A dialog starts it at 2 again: its own title is the `<h2>` that names the
 *   dialog, and panels inside it sit below that.
 * - Without a provider nothing moves, so public pages keep their levels.
 *
 * Only a title primitive (`PageHeader`, `ProfileHeader`, `EventHero`) may land
 * on `<h1>`; a section heading never rises above `<h2>`, so a screen that
 * placed a section beside its title cannot produce a second `<h1>`.
 */
import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingTag = `h${HeadingLevel}`;

/** The authored level of a screen title, which every other level is relative to. */
const AUTHORED_TITLE_LEVEL = 2;

const OutlineShift = createContext(0);

export function HeadingOutline({ titleLevel, children }: { titleLevel: 1 | 2; children: ComponentChildren }) {
  return <OutlineShift.Provider value={titleLevel - AUTHORED_TITLE_LEVEL}>{children}</OutlineShift.Provider>;
}

function headingTag(authored: HeadingLevel, shift: number, floor: HeadingLevel): HeadingTag {
  const level = Math.min(6, Math.max(floor, authored + shift)) as HeadingLevel;
  return `h${level}`;
}

/** The element for a screen title authored at `authored` (2 by convention). */
export function useTitleHeading(authored: HeadingLevel = AUTHORED_TITLE_LEVEL): HeadingTag {
  return headingTag(authored, useContext(OutlineShift), 1);
}

/** The element for a section heading authored at `authored`; never the page's `<h1>`. */
export function useSectionHeading(authored: HeadingLevel): HeadingTag {
  return headingTag(authored, useContext(OutlineShift), 2);
}
